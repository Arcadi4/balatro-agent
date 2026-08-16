local handlers = {}
local card_ids


local function err(error_code, message)
  return { ok = false, error_code = error_code, error_message = message }
end

local function ok(data)
  return { ok = true, data = data }
end

local function card_id(card)
  return card.sort_id or (card.config and card.config.card_id)
end
local function serialize_played_card(card)
  if card.facing == 'back' or card.sprite_facing == 'back' then return { faced_down = true } end
  local enhancement
  if card.ability and card.ability.name then
    local enhancements = {
      ['Bonus Card'] = 'bonus',
      ['Mult Card'] = 'mult',
      ['Wild Card'] = 'wild',
      ['Glass Card'] = 'glass',
      ['Steel Card'] = 'steel',
      ['Stone Card'] = 'stone',
      ['Gold Card'] = 'gold',
      ['Lucky Card'] = 'lucky',
    }
    enhancement = enhancements[card.ability.name]
  end
  local edition
  if card.edition then
    if card.edition.foil then edition = 'foil'
    elseif card.edition.holo then edition = 'holo'
    elseif card.edition.polychrome then edition = 'polychrome'
    elseif card.edition.negative then edition = 'negative' end
  end
  return {
    rank = card.base and card.base.value,
    suit = card.base and card.base.suit,
    enhancement = enhancement,
    edition = edition,
    seal = card.seal,
  }
end


local function check_phase(allowed_phases)
  if not G or not G.STATE or not G.STATES then
    return err("WRONG_PHASE", "Game state not available")
  end
  for _, phase in ipairs(allowed_phases) do
    if G.STATE == G.STATES[phase] then return nil end
  end
  return err("WRONG_PHASE", "Action not allowed in current phase (G.STATE=" .. tostring(G.STATE) .. ")")
end

local function find_card_in(area, target_card_id)
  return card_ids.resolve(area, target_card_id)
end

local function find_card_in_hand(card_id)
  return find_card_in(G.hand, card_id)
end

local function find_card_in_jokers(card_id)
  return find_card_in(G.jokers, card_id)
end

local function find_card_in_consumables(card_id)
  return find_card_in(G.consumeables, card_id)
end

local function find_card_in_shop(card_id)
  local card = find_card_in(G.shop_jokers, card_id)
  if card then return card, "joker" end
  card = find_card_in(G.shop_vouchers, card_id)
  if card then return card, "voucher" end
  card = find_card_in(G.shop_booster, card_id)
  if card then return card, "booster" end
  return nil, nil
end

local function find_card_in_pack(card_id)
  return find_card_in(G.pack_cards, card_id)
end

local function contains_card(cards, target)
  for _, card in ipairs(cards) do
    if card == target then return true end
  end
  return false
end

local function resolve_hand_cards(card_ids)
  local cards = {}
  local requested = {}
  for _, target_id in ipairs(card_ids) do
    local card = find_card_in_hand(target_id)
    if not card then
      return nil, nil, err("INVALID_TARGET", "Card not found in hand: " .. tostring(target_id))
    end
    local key = tostring(card_id(card))
    if requested[key] then
      return nil, nil, err("INVALID_TARGET", "Duplicate hand card ID: " .. key)
    end
    requested[key] = true
    cards[#cards + 1] = card
  end
  return cards, requested
end

local function copy_highlights()
  local cards = {}
  for _, card in ipairs(G.hand.highlighted) do cards[#cards + 1] = card end
  return cards
end

local function replace_highlights(cards)
  G.hand:unhighlight_all()
  for _, card in ipairs(cards) do
    if not contains_card(G.hand.highlighted, card) then G.hand:add_to_highlighted(card) end
  end
end

local function replace_requested_highlights(cards, requested)
  local previous = copy_highlights()
  for _, card in ipairs(previous) do
    if card.ability and card.ability.forced_selection and not requested[tostring(card_id(card))] then
      return nil, nil, err(
        "INVALID_TARGET",
        "Forced hand card " .. tostring(card_ids.public(G.hand, card)) .. " must remain selected; include it in the requested IDs"
      )
    end
  end

  replace_highlights(cards)
  local selected_ids = {}
  for _, card in ipairs(G.hand.highlighted) do
    local key = tostring(card_id(card))
    if not requested[key] then
      replace_highlights(previous)
      return nil, nil, err("INVALID_TARGET", "Balatro retained an unrequested hand card: " .. tostring(card_ids.public(G.hand, card)))
    end
    selected_ids[#selected_ids + 1] = card_ids.public(G.hand, card)
  end
  if #selected_ids ~= #cards then
    replace_highlights(previous)
    return nil, nil, err("INVALID_TARGET", "Balatro did not accept the complete hand selection")
  end
  return selected_ids, previous
end

local function prepare_consumable_targets(card, args, shop_context)
  local target_card_ids = args.targets or {}
  local cons = card.ability and card.ability.consumeable
  if not (cons and cons.max_highlighted) then
    -- Vanilla only reads the hand selection for consumables with a
    -- max_highlighted config; untargeted ones must leave it untouched.
    if #target_card_ids > 0 then
      local name = card.ability and card.ability.name or 'This consumable'
      return err("INVALID_TARGET", "'" .. name .. "' does not target hand cards")
    end
    if card.can_use_consumeable and not card:can_use_consumeable() then
      local name = card.ability and card.ability.name or 'this consumable'
      if shop_context then
        return err(
          "CANNOT_USE_NOW",
          "'" .. name .. "' cannot be applied immediately from the shop: its use conditions are not met (e.g. no free slot for the cards it creates). No money was charged. Buy it with use=false to store it in a consumable slot (if one is free), then apply it with balatro_use_consumable when it becomes usable."
        )
      end
      return err("CANNOT_USE_NOW", "'" .. name .. "' cannot be used right now")
    end
    return nil
  end

  local targets, requested, resolve_err = resolve_hand_cards(target_card_ids)
  if resolve_err then return resolve_err end

  local _, previous, selection_err = replace_requested_highlights(targets, requested)
  if selection_err then return selection_err end

  if card.can_use_consumeable and not card:can_use_consumeable() then
    local name = card.ability and card.ability.name or 'this consumable'
    local use_err
    if shop_context then
      -- A satisfied target range means the shop phase, not the targets, blocked use.
      local count = G.hand and #G.hand.highlighted or 0
      local in_range = count >= (cons.min_highlighted or 1) and count <= cons.max_highlighted
      if in_range then
        use_err = err(
          "CANNOT_USE_NOW",
          "'" .. name .. "' cannot be applied immediately from the shop: hand-targeting and special-case consumables are only usable during hand selection (SELECTING_HAND) or while a booster pack is open, and its use conditions are not met in the shop. No money was charged. Buy it with use=false to store it in a consumable slot (if one is free), then apply it with balatro_use_consumable when it becomes usable."
        )
      end
    end
    if not use_err then
      local hint = #target_card_ids == 0 and "; provide targets for targeted consumables" or ""
      use_err = err("INVALID_TARGET", "Consumable cannot be used with the supplied targets" .. hint)
    end
    replace_highlights(previous)
    return use_err
  end

  return nil, previous
end

local function available_funds()
  if not G or not G.GAME then return 0 end
  return (G.GAME.dollars or 0) - (G.GAME.bankrupt_at or 0)
end

local function require_shop_phase(action_name)
  local phase_err = check_phase({ 'SHOP' })
  if phase_err then
    return err(
      'WRONG_PHASE',
      action_name .. ' can only be used during the SHOP phase. Call balatro_inspect_game_state before buying.'
    )
  end
  return nil
end

local function purchase_tool_hint(set)
  if set == 'Tarot' or set == 'Planet' or set == 'Spectral' then
    return 'Use balatro_buy_consumable (set use=true to apply it immediately, or false to store it in a consumable slot).'
  elseif set == 'Voucher' then
    return 'Use balatro_buy_voucher to redeem it.'
  elseif set == 'Booster' then
    return 'Use balatro_buy_booster — booster packs are bought and opened in a single action.'
  end
  return ''
end

local function check_funds(cost)
  local available = available_funds()
  if cost > available then
    return err(
      'INSUFFICIENT_FUNDS',
      'Cannot afford card (cost=' .. tostring(cost) .. ', available=' .. tostring(available) .. ')'
    )
  end
  return nil
end

local function purchase_from_shop(card, buy_and_use)
  local config = { config = { ref_table = card } }
  if buy_and_use then
    config.config.id = 'buy_and_use'
  end

  local result = G.FUNCS.buy_from_shop(config)
  if result == false then
    return err('SLOTS_FULL', 'The shop refused the purchase (no room for this card type). Free a slot or use the matching purchase tool.')
  end
  return nil
end

local PACK_PHASES = {
  "TAROT_PACK",
  "PLANET_PACK",
  "SPECTRAL_PACK",
  "STANDARD_PACK",
  "BUFFOON_PACK",
  "SMODS_BOOSTER_OPENED",
}

handlers.select_blind = function(args)
  local phase_err = check_phase({ "BLIND_SELECT" })
  if phase_err then return phase_err end

  if not G.GAME or not G.GAME.round_resets or not G.GAME.round_resets.blind_choices then
    return err("INVALID_TARGET", "No blind choices available; blind select UI is not ready")
  end

  local blind_key = G.GAME.blind_on_deck

  if not G.GAME.round_resets.blind_choices[blind_key] then
    return err("INVALID_TARGET", "Blind slot '" .. tostring(blind_key) .. "' not available in current choices")
  end

  local blind_ui = G.blind_select_opts and G.blind_select_opts[string.lower(blind_key)]
  local select_button = blind_ui and blind_ui.get_UIE_by_ID and blind_ui:get_UIE_by_ID("select_blind_button")
  if not select_button or not select_button.UIBox or not select_button.config or not select_button.config.ref_table then
    return err("INVALID_TARGET", "Blind select UI is not ready for slot: " .. tostring(blind_key))
  end

  G.FUNCS.select_blind(select_button)

  return ok({
    blind_selected = string.lower(blind_key),
    blind_id = G.GAME.round_resets.blind_choices[blind_key],
  })
end

handlers.skip_blind = function(args)
  local phase_err = check_phase({ "BLIND_SELECT" })
  if phase_err then return phase_err end

  local round_resets = G.GAME and G.GAME.round_resets
  local blind_key = G.GAME and G.GAME.blind_on_deck
  if blind_key ~= "Small" and blind_key ~= "Big" then
    return err("INVALID_TARGET", "Only Small and Big blinds can be skipped; blind_on_deck=" .. tostring(blind_key))
  end

  local tag_key = round_resets and round_resets.blind_tags and round_resets.blind_tags[blind_key]
  if not tag_key then
    return err("INVALID_TARGET", "No skip tag is available for blind slot: " .. tostring(blind_key))
  end

  local blind_ui = G.blind_select_opts and G.blind_select_opts[string.lower(blind_key)]
  local select_button = blind_ui and blind_ui.get_UIE_by_ID and blind_ui:get_UIE_by_ID("select_blind_button")
  local tag_container = select_button and select_button.UIBox and select_button.UIBox.get_UIE_by_ID
      and select_button.UIBox:get_UIE_by_ID("tag_container")
  if not select_button or not select_button.UIBox or not tag_container then
    return err("INVALID_TARGET", "Blind skip UI is not ready for slot: " .. tostring(blind_key))
  end

  -- The base-game callback reads e.UIBox to resolve the tag reward.
  G.FUNCS.skip_blind(select_button)

  return ok({
    skipped = true,
    blind = string.lower(blind_key),
    tag = tag_key,
  })
end

handlers.reroll_boss = function(args)
  local phase_err = check_phase({ "BLIND_SELECT" })
  if phase_err then return phase_err end

  local game = G.GAME
  local resets = game and game.round_resets
  local vouchers = game and game.used_vouchers
  if not resets or not resets.blind_choices or not vouchers then
    return err("CANNOT_USE_NOW", "Boss reroll state is not ready")
  end
  if G.CONTROLLER and G.CONTROLLER.locks and G.CONTROLLER.locks.boss_reroll then
    return err("CANNOT_USE_NOW", "A boss reroll is already in progress")
  end
  if not vouchers.v_retcon and not vouchers.v_directors_cut then
    return err("INVALID_TARGET", "Director's Cut or Retcon is required to reroll the Boss Blind")
  end
  if vouchers.v_directors_cut and not vouchers.v_retcon and resets.boss_rerolled then
    return err("INVALID_TARGET", "Director's Cut has already rerolled this Ante's Boss Blind")
  end
  local funds_err = check_funds(10)
  if funds_err then return funds_err end
  if not G.FUNCS or type(G.FUNCS.reroll_boss) ~= "function" then
    return err("CANNOT_USE_NOW", "Boss reroll action is not ready")
  end

  local previous_boss = resets.blind_choices.Boss
  G.FUNCS.reroll_boss()
  return ok({ rerolled = true, previous_boss = previous_boss, cost = 10 })
end

handlers.select_hand_cards = function(args)
  local phase_err = check_phase({ "SELECTING_HAND" })
  if phase_err then return phase_err end

  local card_ids = args.card_ids

  local limit = G.hand.config.highlighted_limit
  if #card_ids > limit then
    return err("INVALID_TARGET", "Cannot select more than " .. tostring(limit) .. " cards")
  end

  local cards_to_select, requested, resolve_err = resolve_hand_cards(card_ids)
  if resolve_err then return resolve_err end

  local selected_ids, _, selection_err = replace_requested_highlights(cards_to_select, requested)
  if selection_err then return selection_err end

  return ok({ selected_count = #selected_ids, selected_card_ids = selected_ids })
end

handlers.sort_hand = function(args)
  local phase_err = check_phase({ "SELECTING_HAND" })
  if phase_err then return phase_err end

  local callback = args.order == 'rank' and G.FUNCS.sort_hand_value or G.FUNCS.sort_hand_suit
  callback()
  return ok({ sorted_by = args.order })
end

handlers.play_hand = function(args)
  local phase_err = check_phase({ "SELECTING_HAND" })
  if phase_err then return phase_err end

  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to play")
  end
  local hands_left = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_left or 0
  if hands_left <= 0 then
    return err("INVALID_TARGET", "No hands remaining")
  end

  if G.GAME and G.GAME.blind and G.GAME.blind.block_play then
    return err("INVALID_TARGET", "Boss blind is blocking play")
  end

  local cards_played = #G.hand.highlighted
  local played_cards = {}
  for _, card in ipairs(G.hand.highlighted) do
    played_cards[#played_cards + 1] = serialize_played_card(card)
  end
  local score_before = G.GAME and G.GAME.chips or 0
  local hands_played_before = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_played or 0
  local blind_chips = G.GAME and G.GAME.blind and G.GAME.blind.chips or nil

  G.FUNCS.play_cards_from_highlighted()

  return {
    ok = true,
    deferred = "play_hand_score",
    timeout_seconds = 12,
    data = {
      cards_played = cards_played,
      played_cards = played_cards,
      score_before = score_before,
      hands_played_before = hands_played_before,
      blind_chips = blind_chips,
    }
  }
end

handlers.discard_hand = function(args)
  local phase_err = check_phase({ "SELECTING_HAND" })
  if phase_err then return phase_err end

  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to discard")
  end
  local discards_left = G.GAME and G.GAME.current_round and G.GAME.current_round.discards_left or 0
  if discards_left <= 0 then
    return err("INVALID_TARGET", "No discards remaining")
  end

  local cards_discarded = #G.hand.highlighted
  G.FUNCS.discard_cards_from_highlighted()

  return ok({ cards_discarded = cards_discarded })
end

handlers.use_consumable = function(args)
  local phase_err = check_phase({ "SELECTING_HAND", "SHOP" })
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card = find_card_in_consumables(card_id)
  if not card then
    return err("INVALID_TARGET", "Consumable not found: " .. tostring(card_id))
  end

  local target_err = prepare_consumable_targets(card, args)
  if target_err then return target_err end

  G.FUNCS.use_card({ config = { ref_table = card } })

  return ok({ used = card_id })
end

handlers.sell_card = function(args)
  local phase_err = check_phase({ "BLIND_SELECT", "SELECTING_HAND", "ROUND_EVAL", "SHOP" })
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card = find_card_in_jokers(card_id)
  if not card then
    card = find_card_in_consumables(card_id)
  end
  if not card then
    return err("INVALID_TARGET", "Card not found in jokers or consumables: " .. tostring(card_id))
  end
  if card_ids.hidden(G.jokers, card) and G.jokers and contains_card(G.jokers.cards, card) then
    return err("CANNOT_USE_NOW", "Face-down Jokers cannot be sold while their identity is hidden")
  end

  if not card:can_sell_card() then
    return err("CANNOT_SELL", "Card cannot be sold right now")
  end

  G.FUNCS.sell_card({ config = { ref_table = card } })

  return ok({ sold = card_id, sell_value = card.sell_cost })
end

handlers.buy_card = function(args)
  local phase_err = require_shop_phase('balatro_buy_card')
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  local set = card.config and card.config.center and card.config.center.set
  local is_joker = set == "Joker"
  local is_playing_card = set == "Default" or set == "Enhanced"
  if not (is_joker or is_playing_card) then
    return err(
      "INVALID_TARGET",
      "balatro_buy_card only buys Jokers and regular playing cards (shop playing cards appear once the Magic Trick voucher is active); found a "
        .. tostring(set) .. ". " .. purchase_tool_hint(set)
    )
  end

  local cost = card.cost or 0
  local funds_err = check_funds(cost)
  if funds_err then return funds_err end

  local buy_err = purchase_from_shop(card, false)
  if buy_err then return buy_err end

  return ok({ bought = card_id, cost = cost, kind = is_joker and "joker" or "playing_card" })
end

handlers.buy_consumable = function(args)
  local phase_err = require_shop_phase('balatro_buy_consumable')
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  local set = card.config and card.config.center and card.config.center.set
  if set ~= "Tarot" and set ~= "Planet" and set ~= "Spectral" then
    return err(
      "INVALID_TARGET",
      "balatro_buy_consumable only buys Tarot, Planet, and Spectral cards; found a "
        .. tostring(set) .. ". " .. purchase_tool_hint(set)
    )
  end

  if not args.use and args.targets then
    return err("INVALID_TARGET", "targets is only valid when use=true")
  end

  local cost = card.cost or 0
  local funds_err = check_funds(cost)
  if funds_err then return funds_err end

  local previous_highlights
  if args.use then
    local target_err, previous = prepare_consumable_targets(card, args, true)
    previous_highlights = previous
    if target_err then return target_err end
  end

  -- Vanilla must remove the shop card before its delayed use_card call; doing it here leaves c1.area nil.
  local buy_err = purchase_from_shop(card, args.use)
  if buy_err then
    if previous_highlights then replace_highlights(previous_highlights) end
    return buy_err
  end

  return ok({ bought = card_id, cost = cost, used = args.use })
end

handlers.buy_voucher = function(args)
  local phase_err = require_shop_phase('balatro_buy_voucher')
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card, shop_area = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Voucher not found in shop: " .. tostring(card_id))
  end

  local set = card.config and card.config.center and card.config.center.set
  if shop_area ~= "voucher" or set ~= "Voucher" then
    return err(
      "INVALID_TARGET",
      "balatro_buy_voucher only buys Vouchers; found a " .. tostring(set) .. ". " .. purchase_tool_hint(set)
    )
  end

  local voucher_key = card.config.center.key
  if card.config.center.requires and G.GAME and G.GAME.used_vouchers then
    local reqs = type(card.config.center.requires) == "table" and card.config.center.requires or { card.config.center.requires }
    for _, req in ipairs(reqs) do
      if not G.GAME.used_vouchers[req] then
        return err("VOUCHER_DEPENDENCY", "Requires voucher not yet purchased: " .. tostring(req))
      end
    end
  end

  local cost = card.cost or 0
  local funds_err = check_funds(cost)
  if funds_err then return funds_err end

  G.FUNCS.use_card({ config = { ref_table = card } })

  return ok({ redeemed = card_id, cost = cost, voucher_key = voucher_key })
end

handlers.reroll_shop = function(args)
  local phase_err = check_phase({ "SHOP" })
  if phase_err then return phase_err end

  local free_rerolls = G.GAME.current_round.free_rerolls
  if free_rerolls <= 0 then
    local reroll_cost = G.GAME.current_round.reroll_cost
    if reroll_cost > available_funds() then
      return err("INSUFFICIENT_FUNDS", "Cannot afford reroll (cost=" .. tostring(reroll_cost) .. ", available=" .. tostring(available_funds()) .. ")")
    end
  end

  G.FUNCS.reroll_shop()

  return ok({ rerolled = true })
end

handlers.leave_shop = function(args)
  local phase_err = check_phase({ "SHOP" })
  if phase_err then return phase_err end

  G.FUNCS.toggle_shop()

  return ok({ left_shop = true })
end

handlers.cash_out = function(args)
  local phase_err = check_phase({ "ROUND_EVAL" })
  if phase_err then return phase_err end

  if not G.FUNCS or type(G.FUNCS.cash_out) ~= "function" then
    return err("CANNOT_USE_NOW", "Cash-out action is not ready")
  end
  if not G.round_eval then
    return err("CANNOT_USE_NOW", "Cash-out screen is not ready")
  end
  -- The cash_out_button is rendered in a separate UIBox (major = G.round_eval),
  -- not as a child of G.round_eval, so get_UIE_by_ID never finds it.
  -- G.FUNCS.cash_out only writes e.config.button, so a synthetic table suffices.
  G.FUNCS.cash_out({ config = {} })

  return ok({ cashed_out = true })
end

handlers.restart = function(args)
  if not G or not G.STAGE or not G.STAGES or G.STAGE ~= G.STAGES.RUN then
    return err("WRONG_PHASE", "Restart is only available during a run")
  end
  if not G.GAME then
    return err("GAME_NOT_RUNNING", "No run in progress")
  end

  -- Mirrors holding R in the run: reset the streak, preserve the current
  -- deck/stake/seed, and start a new run without opening the setup screen.
  if not G.GAME.won and not G.GAME.seeded and not G.GAME.challenge then
    G.PROFILES[G.SETTINGS.profile].high_scores.current_streak.amt = 0
  end
  G:save_settings()
  G.SETTINGS.current_setup = 'New Run'
  G.GAME.viewed_back = nil
  G.run_setup_seed = G.GAME.seeded
  G.challenge_tab = G.GAME and G.GAME.challenge and G.GAME.challenge_tab or nil
  G.forced_seed, G.setup_seed = nil, nil
  if G.GAME.seeded then G.forced_seed = G.GAME.pseudorandom.seed end
  G.forced_stake = G.GAME.stake
  G.FUNCS.start_setup_run()
  G.forced_stake = nil
  G.challenge_tab = nil
  G.forced_seed = nil

  return ok({ restarted = true })
end

handlers.continue_game = function(args)
  if not G or not G.STAGE or not G.STAGES or G.STAGE ~= G.STAGES.MAIN_MENU
      or not G.STATE or not G.STATES or G.STATE ~= G.STATES.MENU then
    return err("WRONG_PHASE", "Continue game is only available from the main menu")
  end
  if not G.FUNCS or type(G.FUNCS.can_continue) ~= "function"
      or type(G.FUNCS.start_run) ~= "function" then
    return err("CANNOT_USE_NOW", "Continue game action is not ready")
  end

  local profile = G.SETTINGS and G.SETTINGS.profile
  if profile == nil or not love.filesystem.getInfo(tostring(profile) .. "/save.jkr") then
    return err("CANNOT_USE_NOW", "No saved game is available")
  end

  local can_continue = G.FUNCS.can_continue({ config = { func = true } })
  if not can_continue or not G.SAVED_GAME then
    return err("CANNOT_USE_NOW", "No valid saved game is available")
  end

  G.FUNCS.start_run(nil, { savetext = G.SAVED_GAME })
  return ok({ continued = true })
end
 
handlers.new_game = function(args)
  if not G or not G.GAME then
    return err("GAME_NOT_RUNNING", "Game not ready")
  end
  if not G.FUNCS or type(G.FUNCS.start_setup_run) ~= "function" then
    return err("CANNOT_USE_NOW", "New game action is not ready")
  end

  local challenge = args.challenge
  local deck = args.deck
  local stake = args.stake
  local seed = args.seed

  if challenge then
    if deck or stake or seed then
      return err("INVALID_TARGET", "challenge cannot be combined with deck, stake, or seed")
    end
    local challenge_obj = SMODS.Challenges[challenge]
    if not challenge_obj then
      return err("INVALID_TARGET", "Unknown challenge: " .. tostring(challenge))
    end
    if not (G.PROFILES[G.SETTINGS.profile].all_unlocked or challenge_obj:unlocked()) then
      return err("LOCKED", "Challenge not unlocked: " .. tostring(challenge))
    end
  else
    if not deck or stake == nil then
      return err("INVALID_TARGET", "deck and stake are required when challenge is not specified")
    end
    local deck_center = G.P_CENTERS[deck]
    if not deck_center or deck_center.set ~= 'Back' or deck_center.omit then
      return err("INVALID_TARGET", "Unknown deck: " .. tostring(deck))
    end
    if not deck_center.unlocked and not G.PROFILES[G.SETTINGS.profile].all_unlocked then
      return err("LOCKED", "Deck not unlocked: " .. tostring(deck))
    end
    if type(stake) ~= 'number' or stake < 1 or stake > 8 or stake % 1 ~= 0 then
      return err("INVALID_TARGET", "stake must be an integer between 1 and 8")
    end
    if not SMODS.stake_is_unlocked(SMODS.stake_from_index(stake), deck) then
      return err("LOCKED", "Stake not unlocked for this deck: " .. tostring(stake))
    end
  end

  -- start_setup_run resets the win streak and persists settings itself.
  G.SETTINGS.current_setup = 'New Run'
  G.GAME.viewed_back = nil
  G.run_setup_seed = nil
  G.challenge_tab = nil
  G.forced_seed, G.setup_seed = nil, nil
  G.forced_stake = nil

  if challenge then
    G.forced_stake = 1
    G.challenge_tab = SMODS.Challenges[challenge]
  else
    G.GAME.viewed_back = Back(G.P_CENTERS[deck])
    G.forced_stake = stake
    if seed then G.forced_seed = seed end
  end

  G.FUNCS.start_setup_run()
  G.forced_stake = nil
  G.challenge_tab = nil
  G.forced_seed = nil

  return ok({ started = true })
end

handlers.buy_booster = function(args)
  local phase_err = require_shop_phase('balatro_buy_booster')
  if phase_err then return phase_err end

  local card_id = args.card_id

  local card = find_card_in(G.shop_booster, card_id)
  if not card then
    return err("INVALID_TARGET", "Booster not found in shop: " .. tostring(card_id))
  end

  local cost = card.cost or 0
  local funds_err = check_funds(cost)
  if funds_err then return funds_err end

  G.FUNCS.use_card({ config = { ref_table = card } })

  return ok({
    opened = card_id,
    cost = cost,
    pack = card.ability and card.ability.name,
  })
end

handlers.select_booster_card = function(args)
  local phase_err = check_phase(PACK_PHASES)
  if phase_err then return phase_err end

  local card_id = args.card_id

  local picks_remaining = G.GAME.pack_choices
  if picks_remaining <= 0 then
    return err("PACK_LIMIT_REACHED", "All picks from booster pack already used")
  end

  local card = find_card_in_pack(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in pack: " .. tostring(card_id))
  end

  local set = card.config and card.config.center and card.config.center.set
  if set == "Tarot" or set == "Planet" or set == "Spectral" then
    local target_err = prepare_consumable_targets(card, args)
    if target_err then return target_err end
  end

  local select_area = booster_obj
    and SMODS.card_select_area(card, booster_obj)
    and card:selectable_from_pack(booster_obj)
  if select_area then
    local edition_card_limit = card.ability.card_limit - card.ability.extra_slots_used
    if #G[select_area].cards >= G[select_area].config.card_limit + edition_card_limit then
      return err("SLOTS_FULL", "No available " .. tostring(select_area) .. " slots")
    end
  elseif card.ability.set == "Joker" then
    local edition_card_limit = card.ability.card_limit - card.ability.extra_slots_used
    if #G.jokers.cards >= G.jokers.config.card_limit + edition_card_limit then
      return err("SLOTS_FULL", "No available joker slots")
    end
  end

  G.FUNCS.use_card({ config = { ref_table = card } })

  return ok({ selected = card_id })
end

handlers.skip_booster = function(args)
  local phase_err = check_phase(PACK_PHASES)
  if phase_err then return phase_err end

  G.FUNCS.skip_booster()

  return ok({ skipped_booster = true })
end

handlers.reorder_jokers = function(args)
  local phase_err = check_phase({ "SELECTING_HAND", "SHOP" })
  if phase_err then return phase_err end

  local requested_ids = args.card_ids
  card_ids.sync(G.jokers)

  local current_count = #G.jokers.cards
  if #requested_ids ~= current_count then
    return err("INVALID_TARGET", "card_ids count (" .. #requested_ids .. ") does not match joker count (" .. current_count .. ")")
  end

  local id_to_card = {}
  for _, card in ipairs(G.jokers.cards) do
    local key = tostring(card_ids.public(G.jokers, card))
    id_to_card[key] = card
  end

  local seen = {}
  for _, cid in ipairs(requested_ids) do
    local key = tostring(cid)
    if not id_to_card[key] then
      return err("INVALID_TARGET", "Joker ID not found: " .. tostring(cid))
    end
    if seen[key] then
      return err("INVALID_TARGET", "Duplicate joker ID in reorder: " .. tostring(cid))
    end
    seen[key] = true
  end

  local new_order = {}
  for _, cid in ipairs(requested_ids) do
    new_order[#new_order + 1] = id_to_card[tostring(cid)]
  end
  G.jokers.cards = new_order
  card_ids.sync(G.jokers)

  G.jokers:set_ranks()

  return ok({ reordered = true, count = current_count })
end

function handlers.configure(ids)
  card_ids = ids
end

return handlers
