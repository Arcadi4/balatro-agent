--- actions.lua ? Action dispatcher for the Balatro MCP bridge.
-- Maps each command kind to the correct Balatro G.FUNCS call with phase guards
-- and sticker rules. Defense-in-depth: re-checks G.STATE before every action.

local Actions = {}

--- Registry of action handlers
local handlers = {}

--- Phase constants (resolved lazily from G.STATES)
local function S(name)
  return G and G.STATES and G.STATES[name]
end

---------------------------------------------------------------------------
-- Utility: error/success response builders
---------------------------------------------------------------------------

local function err(error_code, message)
  return { ok = false, error_code = error_code, error_message = message }
end

local function ok(data)
  return { ok = true, data = data or {} }
end

local function normalize_entity_id(id)
  if not id then return nil end
  local value = tostring(id):gsub("%s+", "_"):lower()
  if value:match("^[jcvpmeb]_") or value:match("^bl_") or value:match("^tag_") then
    return value
  end

  return nil
end

local function entity_type_from_center(center)
  if not center then return nil end
  local set = center.set
  if set == "Joker" then return "joker" end
  if set == "Tarot" then return "tarot" end
  if set == "Planet" then return "planet" end
  if set == "Spectral" then return "spectral" end
  if set == "Voucher" then return "voucher" end
  if set == "Booster" then return "booster" end
  if set == "Blind" then return "blind" end
  return set and tostring(set):lower() or nil
end

local function compact_table(value, depth)
  if type(value) ~= "table" then return value end
  if depth <= 0 then return nil end
  local out = {}
  for k, v in pairs(value) do
    if type(k) == "string" or type(k) == "number" then
      local value_type = type(v)
      if value_type == "string" or value_type == "number" or value_type == "boolean" then
        out[k] = v
      elseif value_type == "table" then
        out[k] = compact_table(v, depth - 1)
      end
    end
  end
  return next(out) and out or nil
end

local function get_card_stickers(card)
  if not card then return nil end
  local stickers = {}
  if card.ability and card.ability.eternal then stickers[#stickers + 1] = "eternal" end
  if card.ability and card.ability.perishable then stickers[#stickers + 1] = "perishable" end
  if card.ability and card.ability.rental then stickers[#stickers + 1] = "rental" end
  if #stickers == 0 then return nil end
  return stickers
end

local function get_card_edition(card)
  if not card or not card.edition then return nil end
  if card.edition.foil then return "foil" end
  if card.edition.holo then return "holo" end
  if card.edition.polychrome then return "polychrome" end
  if card.edition.negative then return "negative" end
  return nil
end

local function serialize_center(center)
  if not center then return nil end
  local loc_txt = center.loc_txt or {}
  return {
    id = center.key,
    type = entity_type_from_center(center),
    name = loc_txt.name or center.name or center.key,
    game_name = center.name,
    set = center.set,
    description = loc_txt.text,
    config = compact_table(center.config, 3),
    rarity = center.rarity,
    cost = center.cost,
    blueprint_compat = center.blueprint_compat,
    perishable_compat = center.perishable_compat,
    eternal_compat = center.eternal_compat,
    unlocked = center.unlocked,
    discovered = center.discovered,
  }
end

local function serialize_live_match(card, location)
  if not card then return nil end
  return {
    card_id = card.sort_id or (card.config and card.config.card_id),
    location = location,
    name = card.ability and card.ability.name,
    sell_value = card.sell_cost,
    cost = card.cost,
    edition = get_card_edition(card),
    stickers = get_card_stickers(card),
    debuffed = card.debuff or nil,
    runtime_fields = card.ability and compact_table(card.ability.extra, 3) or nil,
  }
end

local function append_matches(matches, area, location, key)
  if not area or not area.cards then return end
  for _, card in ipairs(area.cards) do
    local center_key = card.config and card.config.center and card.config.center.key
    if center_key == key then
      matches[#matches + 1] = serialize_live_match(card, location)
    end
  end
end

local function live_matches_for_entity(key)
  local matches = {}
  append_matches(matches, G and G.jokers, "jokers", key)
  append_matches(matches, G and G.consumeables, "consumables", key)
  append_matches(matches, G and G.hand, "hand", key)
  append_matches(matches, G and G.shop_jokers, "shop.jokers", key)
  append_matches(matches, G and G.shop_vouchers, "shop.vouchers", key)
  append_matches(matches, G and G.shop_booster, "shop.boosters", key)
  append_matches(matches, G and G.pack_cards, "pack.options", key)
  return #matches > 0 and matches or nil
end

---------------------------------------------------------------------------
-- Phase guard: check G.STATE against allowed states
---------------------------------------------------------------------------

local function check_phase(allowed_states)
  if not G or not G.STATE then
    return err("WRONG_PHASE", "Game state not available")
  end
  for _, state in ipairs(allowed_states) do
    if G.STATE == state then
      return nil -- pass
    end
  end
  return err("WRONG_PHASE", "Action not allowed in current phase (G.STATE=" .. tostring(G.STATE) .. ")")
end

---------------------------------------------------------------------------
-- Card resolution helpers
---------------------------------------------------------------------------

local function find_card_in(area, card_id)
  if not area or not area.cards then return nil end
  local target_id = tostring(card_id)
  for _, card in ipairs(area.cards) do
    local cid = card.sort_id or (card.config and card.config.card_id)
    if cid ~= nil and tostring(cid) == target_id then
      return card
    end
  end
  return nil
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

---------------------------------------------------------------------------
-- Sticker checks
---------------------------------------------------------------------------

local function has_eternal(card)
  return card and card.ability and card.ability.eternal
end

---------------------------------------------------------------------------
-- Funds check
---------------------------------------------------------------------------

local function available_funds()
  if not G or not G.GAME then return 0 end
  return (G.GAME.dollars or 0) - (G.GAME.bankrupt_at or 0)
end

---------------------------------------------------------------------------
-- Pack states helper
---------------------------------------------------------------------------

local function get_pack_states()
  local states = {}
  if S("TAROT_PACK") then states[#states + 1] = S("TAROT_PACK") end
  if S("PLANET_PACK") then states[#states + 1] = S("PLANET_PACK") end
  if S("SPECTRAL_PACK") then states[#states + 1] = S("SPECTRAL_PACK") end
  if S("STANDARD_PACK") then states[#states + 1] = S("STANDARD_PACK") end
  if S("BUFFOON_PACK") then states[#states + 1] = S("BUFFOON_PACK") end
  if S("SMODS_BOOSTER_OPENED") then states[#states + 1] = S("SMODS_BOOSTER_OPENED") end
  return states
end

local function is_pack_state()
  if not G or not G.STATE then return false end
  local pack_states = get_pack_states()
  for _, ps in ipairs(pack_states) do
    if G.STATE == ps then return true end
  end
  return false
end

---------------------------------------------------------------------------
-- QUERY: list_game_entities
---------------------------------------------------------------------------

handlers.list_game_entities = function(args)
  if not G or not G.P_CENTERS then
    return err("GAME_NOT_RUNNING", "Game prototypes are not available")
  end

  local requested_id = normalize_entity_id(args.id)
  if args.id and not requested_id then
    return err("INVALID_TARGET", "Entity id must be an in-game key such as j_odd_todd, c_strength, or tag_coupon")
  end
  local limit = tonumber(args.limit) or 20
  local offset = tonumber(args.offset) or 0
  if limit < 1 then limit = 1 end
  if limit > 100 then limit = 100 end
  if offset < 0 then offset = 0 end

  local records = {}
  for key, center in pairs(G.P_CENTERS) do
    local id_ok = not requested_id or requested_id == key
    if id_ok then
      local record = serialize_center(center)
      if record then
        record.live_instances = live_matches_for_entity(key)
        records[#records + 1] = record
      end
    end
  end

  table.sort(records, function(a, b)
    return tostring(a.id or "") < tostring(b.id or "")
  end)

  local total = #records
  local items = {}
  for i = offset + 1, math.min(offset + limit, total) do
    items[#items + 1] = records[i]
  end

  return ok({
    items = items,
    total = total,
    count = #items,
    offset = offset,
    has_more = offset + limit < total,
    next_offset = (offset + limit < total) and (offset + limit) or nil,
    source = "runtime:G.P_CENTERS",
  })
end

---------------------------------------------------------------------------
-- ACTION: select_blind
---------------------------------------------------------------------------

handlers.select_blind = function(args)
  local phase_err = check_phase({ S("BLIND_SELECT") })
  if phase_err then return phase_err end

  if not G.GAME or not G.GAME.round_resets or not G.GAME.round_resets.blind_choices then
    return err("INVALID_TARGET", "No blind choices available; blind select UI is not ready")
  end

  local blind_key = G.GAME.blind_on_deck
  if args.slot then
    blind_key = args.slot == "small" and "Small" or args.slot == "big" and "Big" or args.slot == "boss" and "Boss" or nil
  end

  if not blind_key or (blind_key ~= "Small" and blind_key ~= "Big" and blind_key ~= "Boss") then
    return err("INVALID_TARGET", "Invalid blind slot: " .. tostring(args.slot) .. "; blind_on_deck=" .. tostring(G.GAME and G.GAME.blind_on_deck))
  end

  if not G.GAME.round_resets.blind_choices[blind_key] then
    return err("INVALID_TARGET", "Blind slot '" .. tostring(blind_key) .. "' not available in current choices")
  end

  local blind_ui = G.blind_select_opts and G.blind_select_opts[string.lower(blind_key)]
  local select_button = blind_ui and blind_ui.get_UIE_by_ID and blind_ui:get_UIE_by_ID("select_blind_button")
  if not select_button or not select_button.UIBox or not select_button.config or not select_button.config.ref_table then
    return err("INVALID_TARGET", "Blind select UI is not ready for slot: " .. tostring(blind_key) .. "; blind_select_opts=" .. tostring(G.blind_select_opts ~= nil) .. "; blind_ui=" .. tostring(blind_ui ~= nil) .. "; select_button=" .. tostring(select_button ~= nil))
  end

  if G.FUNCS and G.FUNCS.select_blind then
    G.FUNCS.select_blind(select_button)
  end

  return ok({
    blind_selected = string.lower(blind_key),
    blind_id = G.GAME.round_resets.blind_choices[blind_key],
  })
end

---------------------------------------------------------------------------
-- ACTION: skip_blind
---------------------------------------------------------------------------

handlers.skip_blind = function(args)
  local phase_err = check_phase({ S("BLIND_SELECT") })
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

  if not G.FUNCS or not G.FUNCS.skip_blind then
    return err("INVALID_TARGET", "Blind skip callback is unavailable")
  end

  -- The base-game callback reads e.UIBox to resolve the tag reward.
  G.FUNCS.skip_blind(select_button)

  return ok({
    skipped = true,
    blind = string.lower(blind_key),
    tag = tag_key,
  })
end

---------------------------------------------------------------------------
-- ACTION: select_hand_cards
---------------------------------------------------------------------------

handlers.select_hand_cards = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  local card_ids = args.card_ids
  if not card_ids or type(card_ids) ~= "table" then
    return err("INVALID_TARGET", "card_ids must be an array")
  end

  -- Validate count
  local limit = (G.hand and G.hand.config and G.hand.config.highlighted_limit) or 5
  if #card_ids > limit then
    return err("INVALID_TARGET", "Cannot select more than " .. tostring(limit) .. " cards")
  end

  -- Resolve all cards first
  local cards_to_select = {}
  for _, cid in ipairs(card_ids) do
    local card = find_card_in_hand(cid)
    if not card then
      return err("INVALID_TARGET", "Card not found in hand: " .. tostring(cid))
    end
    cards_to_select[#cards_to_select + 1] = card
  end

  -- Unhighlight all current selections
  if G.hand and G.hand.unhighlight_all then
    G.hand:unhighlight_all()
  elseif G.hand and G.hand.highlighted then
    -- Manual fallback
    for i = #G.hand.highlighted, 1, -1 do
      local c = G.hand.highlighted[i]
      if c and c.unhighlight then c:unhighlight() end
    end
  end

  -- Highlight requested cards
  for _, card in ipairs(cards_to_select) do
    if G.hand and G.hand.add_to_highlighted then
      G.hand:add_to_highlighted(card)
    elseif card.highlight then
      card:highlight(true)
    end
  end

  return ok({ selected_count = #cards_to_select })
end

---------------------------------------------------------------------------
-- ACTION: sort_hand
---------------------------------------------------------------------------

handlers.sort_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  if args.order and type(args.order) == "table" then
    if not G.hand or not G.hand.cards then
      return err("INVALID_TARGET", "No hand cards to reorder")
    end

    local current_count = #G.hand.cards
    if #args.order ~= current_count then
      return err("INVALID_TARGET", "order count (" .. tostring(#args.order) .. ") does not match hand count (" .. tostring(current_count) .. ")")
    end

    local current_ids = {}
    local id_to_card = {}
    for _, card in ipairs(G.hand.cards) do
      local cid = card.sort_id or (card.config and card.config.card_id)
      local key = tostring(cid)
      current_ids[key] = true
      id_to_card[key] = card
    end

    local seen = {}
    for _, cid in ipairs(args.order) do
      local key = tostring(cid)
      if not current_ids[key] then
        return err("INVALID_TARGET", "Hand card ID not found: " .. tostring(cid))
      end
      if seen[key] then
        return err("INVALID_TARGET", "Duplicate hand card ID in order: " .. tostring(cid))
      end
      seen[key] = true
    end

    local new_order = {}
    for _, cid in ipairs(args.order) do
      new_order[#new_order + 1] = id_to_card[tostring(cid)]
    end
    G.hand.cards = new_order
    if G.hand.set_ranks then
      G.hand:set_ranks()
    end
    return ok({ reordered = true, count = current_count })
  end

  local by = args.by
  if by ~= "rank" and by ~= "suit" then
    return err("INVALID_TARGET", "Sort criterion must be 'rank' or 'suit', got: " .. tostring(by))
  end

  if by == "rank" then
    if G.FUNCS and G.FUNCS.sort_hand_value then
      G.FUNCS.sort_hand_value()
    end
  else
    if G.FUNCS and G.FUNCS.sort_hand_suit then
      G.FUNCS.sort_hand_suit()
    end
  end

  return ok({ sorted_by = by })
end

---------------------------------------------------------------------------
-- ACTION: play_hand
---------------------------------------------------------------------------

handlers.play_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  -- Check cards are highlighted
  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to play")
  end
  if #G.hand.highlighted > 5 then
    return err("INVALID_TARGET", "More than 5 cards selected")
  end

  -- Check hands remaining
  local hands_left = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_left or 0
  if hands_left <= 0 then
    return err("INVALID_TARGET", "No hands remaining")
  end

  -- Check boss blind block_play
  if G.GAME and G.GAME.blind and G.GAME.blind.block_play then
    return err("INVALID_TARGET", "Boss blind is blocking play")
  end

  local cards_played = #G.hand.highlighted
  local score_before = G.GAME and G.GAME.chips or 0
  local hands_played_before = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_played or 0
  local blind_chips = G.GAME and G.GAME.blind and G.GAME.blind.chips or nil

  if G.FUNCS and G.FUNCS.play_cards_from_highlighted then
    G.FUNCS.play_cards_from_highlighted()
  end

  return {
    ok = true,
    deferred = "play_hand_score",
    timeout_seconds = 12,
    data = {
      cards_played = cards_played,
      score_before = score_before,
      hands_played_before = hands_played_before,
      blind_chips = blind_chips,
    }
  }
end

---------------------------------------------------------------------------
-- ACTION: discard_hand
---------------------------------------------------------------------------

handlers.discard_hand = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND") })
  if phase_err then return phase_err end

  -- Check cards are highlighted
  if not G.hand or not G.hand.highlighted or #G.hand.highlighted == 0 then
    return err("INVALID_TARGET", "No cards selected to discard")
  end
  if #G.hand.highlighted > 5 then
    return err("INVALID_TARGET", "More than 5 cards selected")
  end

  -- Check discards remaining
  local discards_left = G.GAME and G.GAME.current_round and G.GAME.current_round.discards_left or 0
  if discards_left <= 0 then
    return err("INVALID_TARGET", "No discards remaining")
  end

  local cards_discarded = #G.hand.highlighted
  if G.FUNCS and G.FUNCS.discard_cards_from_highlighted then
    G.FUNCS.discard_cards_from_highlighted()
  end

  return ok({ cards_discarded = cards_discarded })
end

---------------------------------------------------------------------------
-- ACTION: use_consumable
---------------------------------------------------------------------------

handlers.use_consumable = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND"), S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card = find_card_in_consumables(card_id)
  if not card then
    return err("INVALID_TARGET", "Consumable not found: " .. tostring(card_id))
  end

  -- Check can_use_consumeable
  if card.can_use_consumeable and not card:can_use_consumeable() then
    return err("INVALID_TARGET", "Consumable cannot be used in current context")
  end

  -- If target_card_ids provided, highlight those cards first
  if args.target_card_ids and type(args.target_card_ids) == "table" and #args.target_card_ids > 0 then
    -- Unhighlight all first
    if G.hand and G.hand.unhighlight_all then
      G.hand:unhighlight_all()
    end
    -- Highlight targets
    for _, tid in ipairs(args.target_card_ids) do
      local target = find_card_in_hand(tid)
      if not target then
        return err("INVALID_TARGET", "Target card not found in hand: " .. tostring(tid))
      end
      if G.hand and G.hand.add_to_highlighted then
        G.hand:add_to_highlighted(target)
      end
    end
  end

  -- Use the consumable
  if G.FUNCS and G.FUNCS.use_card then
    G.FUNCS.use_card({ config = { ref_table = card } })
  end

  return ok({ used = card_id })
end

---------------------------------------------------------------------------
-- ACTION: sell_card
---------------------------------------------------------------------------

handlers.sell_card = function(args)
  local phase_err = check_phase({ S("BLIND_SELECT"), S("SELECTING_HAND"), S("ROUND_EVAL"), S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  -- Find card in jokers or consumables
  local card = find_card_in_jokers(card_id)
  if not card then
    card = find_card_in_consumables(card_id)
  end
  if not card then
    return err("INVALID_TARGET", "Card not found in jokers or consumables: " .. tostring(card_id))
  end

  -- Sticker guard: Eternal blocks sell
  if has_eternal(card) then
    return err("ETERNAL_BLOCKED", "Card has Eternal sticker and cannot be sold")
  end

  -- Sell the card
  if G.FUNCS and G.FUNCS.sell_card then
    G.FUNCS.sell_card({ config = { ref_table = card } })
  end

  return ok({ sold = card_id, sell_value = card.sell_cost })
end

---------------------------------------------------------------------------
-- ACTION: buy_card
---------------------------------------------------------------------------

handlers.buy_card = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card, shop_area = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford card (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  -- Check slots for jokers
  if shop_area == "joker" then
    local joker_count = G.jokers and G.jokers.cards and #G.jokers.cards or 0
    local joker_limit = G.jokers and G.jokers.config and G.jokers.config.card_limit or 5
    if joker_count >= joker_limit then
      return err("SLOTS_FULL", "No available joker slots")
    end
  end

  -- Check slots for consumables (if it's a consumable in shop_jokers area)
  if card.config and card.config.center then
    local set = card.config.center.set
    if set == "Tarot" or set == "Planet" or set == "Spectral" then
      local cons_count = G.consumeables and G.consumeables.cards and #G.consumeables.cards or 0
      local cons_limit = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit or 2
      if cons_count >= cons_limit then
        return err("SLOTS_FULL", "No available consumable slots")
      end
    end
  end

  -- Voucher dependency check
  local voucher_key = nil
  if shop_area == "voucher" and card.config and card.config.center then
    local center = card.config.center
    if center.set ~= "Voucher" then
      return err("INVALID_TARGET", "Card in voucher area is not a Voucher: " .. tostring(center.set))
    end
    voucher_key = center.key
    if center.requires and G.GAME and G.GAME.used_vouchers then
      -- Check each required voucher
      local reqs = type(center.requires) == "table" and center.requires or { center.requires }
      for _, req in ipairs(reqs) do
        if not G.GAME.used_vouchers[req] then
          return err("VOUCHER_DEPENDENCY", "Requires voucher not yet purchased: " .. tostring(req))
        end
      end
    end
  end

  -- Buy/redeem the card. Balatro vouchers use the redeem/use path, not the
  -- normal buy path; buy_from_shop routes non-consumables into G.jokers.
  if shop_area == "voucher" then
    if not G.FUNCS or not G.FUNCS.use_card then
      return err("INTERNAL_ERROR", "Balatro use_card callback is unavailable")
    end
    G.FUNCS.use_card({ config = { ref_table = card } })
    if voucher_key and G.GAME and G.GAME.used_vouchers and not G.GAME.used_vouchers[voucher_key] then
      return err("INTERNAL_ERROR", "Voucher was not redeemed: " .. tostring(voucher_key))
    end
  elseif G.FUNCS and G.FUNCS.buy_from_shop then
    G.FUNCS.buy_from_shop({ config = { ref_table = card } })
  end

  return ok({ bought = card_id, cost = cost, shop_area = shop_area, voucher_key = voucher_key })
end

---------------------------------------------------------------------------
-- ACTION: buy_and_use_card
---------------------------------------------------------------------------

handlers.buy_and_use_card = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card, shop_area = find_card_in_shop(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in shop: " .. tostring(card_id))
  end

  -- Must be a consumable
  if not card.config or not card.config.center then
    return err("INVALID_TARGET", "Card is not a consumable")
  end
  local set = card.config.center.set
  if set ~= "Tarot" and set ~= "Planet" and set ~= "Spectral" then
    return err("INVALID_TARGET", "Only consumables (Tarot/Planet/Spectral) can be bought and used immediately")
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford card (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  -- Check can_use
  if card.can_use_consumeable and not card:can_use_consumeable() then
    return err("INVALID_TARGET", "Consumable cannot be used in current context")
  end

  -- If target_card_ids provided, highlight those cards first
  if args.target_card_ids and type(args.target_card_ids) == "table" and #args.target_card_ids > 0 then
    if G.hand and G.hand.unhighlight_all then
      G.hand:unhighlight_all()
    end
    for _, tid in ipairs(args.target_card_ids) do
      local target = find_card_in_hand(tid)
      if not target then
        return err("INVALID_TARGET", "Target card not found in hand: " .. tostring(tid))
      end
      if G.hand and G.hand.add_to_highlighted then
        G.hand:add_to_highlighted(target)
      end
    end
  end

  -- Native Balatro buy-and-use is a single delayed buy_from_shop flow. Passing
  -- id='buy_and_use' makes buy_from_shop skip slot placement and call use_card
  -- after it removes the card from the shop; calling use_card immediately races
  -- that delayed removal and leaves c1.area nil in button_callbacks.lua.
  if G.FUNCS and G.FUNCS.buy_from_shop then
    G.FUNCS.buy_from_shop({ config = { id = "buy_and_use", ref_table = card } })
  end

  return ok({ bought_and_used = card_id, cost = cost })
end

---------------------------------------------------------------------------
-- ACTION: reroll_shop
---------------------------------------------------------------------------

handlers.reroll_shop = function(args)
  local phase_err = check_phase({ S("SHOP"), S("BLIND_SELECT") })
  if phase_err then return phase_err end

  -- Boss reroll guard: in BLIND_SELECT, require Retcon voucher
  if G.STATE == S("BLIND_SELECT") then
    if not G.GAME or not G.GAME.used_vouchers or not G.GAME.used_vouchers.v_retcon then
      return err("BOSS_REROLL_LOCKED", "Boss blind reroll requires Retcon voucher")
    end
  end

  -- Check funds (unless free rerolls available)
  local free_rerolls = G.GAME and G.GAME.current_round and G.GAME.current_round.free_rerolls or 0
  if free_rerolls <= 0 then
    local reroll_cost = G.GAME and G.GAME.current_round and G.GAME.current_round.reroll_cost or 5
    if reroll_cost > available_funds() then
      return err("INSUFFICIENT_FUNDS", "Cannot afford reroll (cost=" .. tostring(reroll_cost) .. ", available=" .. tostring(available_funds()) .. ")")
    end
  end

  if G.FUNCS and G.FUNCS.reroll_shop then
    G.FUNCS.reroll_shop()
  end

  return ok({ rerolled = true })
end

---------------------------------------------------------------------------
-- ACTION: leave_shop
---------------------------------------------------------------------------

handlers.leave_shop = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  if G.FUNCS and G.FUNCS.toggle_shop then
    G.FUNCS.toggle_shop()
  end

  return ok({ left_shop = true })
end

---------------------------------------------------------------------------
-- ACTION: cash_out
---------------------------------------------------------------------------

handlers.cash_out = function(args)
  local phase_err = check_phase({ S("ROUND_EVAL") })
  if phase_err then return phase_err end

  if G.FUNCS and G.FUNCS.cash_out then
    local cash_out_button = nil
    if G.round_eval and G.round_eval.get_UIE_by_ID then
      cash_out_button = G.round_eval:get_UIE_by_ID("cash_out_button")
    end
    G.FUNCS.cash_out(cash_out_button or { config = { id = "cash_out_button", button = "cash_out" } })
  end

  return ok({ cashed_out = true })
end

---------------------------------------------------------------------------
-- ACTION: open_booster
---------------------------------------------------------------------------

handlers.open_booster = function(args)
  local phase_err = check_phase({ S("SHOP") })
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  local card = find_card_in(G.shop_booster, card_id)
  if not card then
    return err("INVALID_TARGET", "Booster not found in shop: " .. tostring(card_id))
  end

  -- Check funds
  local cost = card.cost or 0
  if cost > available_funds() then
    return err("INSUFFICIENT_FUNDS", "Cannot afford booster (cost=" .. tostring(cost) .. ", available=" .. tostring(available_funds()) .. ")")
  end

  -- Open the booster (buy + open)
  if G.FUNCS and G.FUNCS.use_card then
    G.FUNCS.use_card({ config = { ref_table = card } })
  end

  return ok({ opened = card_id })
end

---------------------------------------------------------------------------
-- ACTION: select_booster_card
---------------------------------------------------------------------------

handlers.select_booster_card = function(args)
  local pack_states = get_pack_states()
  local phase_err = check_phase(pack_states)
  if phase_err then return phase_err end

  local card_id = args.card_id
  if not card_id then
    return err("INVALID_TARGET", "card_id is required")
  end

  -- Check picks remaining
  local picks_remaining = G.GAME and G.GAME.pack_choices or 0
  if picks_remaining <= 0 then
    return err("PACK_LIMIT_REACHED", "All picks from booster pack already used")
  end

  -- Find card in pack
  local card = find_card_in_pack(card_id)
  if not card then
    return err("INVALID_TARGET", "Card not found in pack: " .. tostring(card_id))
  end

  -- Check destination slots
  if card.config and card.config.center then
    local set = card.config.center.set
    if set == "Joker" then
      local joker_count = G.jokers and G.jokers.cards and #G.jokers.cards or 0
      local joker_limit = G.jokers and G.jokers.config and G.jokers.config.card_limit or 5
      if joker_count >= joker_limit then
        return err("SLOTS_FULL", "No available joker slots")
      end
    elseif set == "Tarot" or set == "Planet" or set == "Spectral" then
      local cons_count = G.consumeables and G.consumeables.cards and #G.consumeables.cards or 0
      local cons_limit = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit or 2
      if cons_count >= cons_limit then
        return err("SLOTS_FULL", "No available consumable slots")
      end
    end
  end

  -- Select the card from the pack
  if G.FUNCS and G.FUNCS.use_card then
    G.FUNCS.use_card({ config = { ref_table = card } })
  end

  return ok({ selected = card_id })
end

---------------------------------------------------------------------------
-- ACTION: skip_booster
---------------------------------------------------------------------------

handlers.skip_booster = function(args)
  local pack_states = get_pack_states()
  local phase_err = check_phase(pack_states)
  if phase_err then return phase_err end

  if G.FUNCS and G.FUNCS.skip_booster then
    G.FUNCS.skip_booster()
  end

  return ok({ skipped_booster = true })
end

---------------------------------------------------------------------------
-- ACTION: reorder_jokers
---------------------------------------------------------------------------

handlers.reorder_jokers = function(args)
  local phase_err = check_phase({ S("SELECTING_HAND"), S("SHOP") })
  if phase_err then return phase_err end

  local card_ids = args.card_ids
  if not card_ids or type(card_ids) ~= "table" then
    return err("INVALID_TARGET", "card_ids must be an array")
  end

  -- Validate permutation: must be exact same set as current jokers
  if not G.jokers or not G.jokers.cards then
    return err("INVALID_TARGET", "No jokers to reorder")
  end

  local current_count = #G.jokers.cards
  if #card_ids ~= current_count then
    return err("INVALID_TARGET", "card_ids count (" .. #card_ids .. ") does not match joker count (" .. current_count .. ")")
  end

  -- Build lookup of current joker IDs
  local current_ids = {}
  local id_to_card = {}
  for _, card in ipairs(G.jokers.cards) do
    local cid = card.sort_id or (card.config and card.config.card_id)
    local key = tostring(cid)
    current_ids[key] = true
    id_to_card[key] = card
  end

  -- Validate all provided IDs exist and are unique
  local seen = {}
  for _, cid in ipairs(card_ids) do
    local key = tostring(cid)
    if not current_ids[key] then
      return err("INVALID_TARGET", "Joker ID not found: " .. tostring(cid))
    end
    if seen[key] then
      return err("INVALID_TARGET", "Duplicate joker ID in reorder: " .. tostring(cid))
    end
    seen[key] = true
  end

  -- Reorder: rebuild G.jokers.cards in the requested order
  local new_order = {}
  for _, cid in ipairs(card_ids) do
    new_order[#new_order + 1] = id_to_card[tostring(cid)]
  end
  G.jokers.cards = new_order

  -- Update ranks if method available
  if G.jokers.set_ranks then
    G.jokers:set_ranks()
  end

  return ok({ reordered = true, count = current_count })
end

---------------------------------------------------------------------------
-- Public API
---------------------------------------------------------------------------

--- Register a single action handler
function Actions.register_action(kind, handler)
  handlers[kind] = handler
end

--- Dispatch an action by kind. Wraps in pcall for safety.
--- @param kind string The action kind
--- @param args table The action arguments
--- @return table Result with ok, error_code, message, data fields
function Actions.dispatch(kind, args)
  local handler = handlers[kind]
  if not handler then
    return err("INTERNAL_ERROR", "Unknown action kind: " .. tostring(kind))
  end

  local success, result = pcall(handler, args or {})
  if not success then
    return err("INTERNAL_ERROR", "Action '" .. tostring(kind) .. "' raised error: " .. tostring(result))
  end

  if type(result) ~= "table" then
    return ok()
  end

  return result
end

--- Register all built-in handlers with a Commands module
--- @param commands table The Commands module with register_action method
function Actions.register_all(commands)
  for kind, handler in pairs(handlers) do
    commands.register_action(kind, function(args)
      return Actions.dispatch(kind, args)
    end)
  end
end

--- Get list of registered action kinds (for debugging)
function Actions.list_kinds()
  local kinds = {}
  for kind, _ in pairs(handlers) do
    kinds[#kinds + 1] = kind
  end
  table.sort(kinds)
  return kinds
end

return Actions
