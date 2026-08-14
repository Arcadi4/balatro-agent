local State = {}
local PROTOCOL_VERSION = 1
local seq = 0
local PHASE_NAMES = {
  'SELECTING_HAND',
  'BLIND_SELECT',
  'SHOP',
  'TAROT_PACK',
  'PLANET_PACK',
  'SPECTRAL_PACK',
  'STANDARD_PACK',
  'BUFFOON_PACK',
  'SMODS_BOOSTER_OPENED',
  'ROUND_EVAL',
  'HAND_PLAYED',
  'DRAW_TO_HAND',
  'NEW_ROUND',
  'GAME_OVER',
  'MENU',
  'SPLASH',
}
local PACK_KINDS = {
  TAROT_PACK = 'tarot',
  PLANET_PACK = 'planet',
  SPECTRAL_PACK = 'spectral',
  STANDARD_PACK = 'standard',
  BUFFOON_PACK = 'buffoon',
  SMODS_BOOSTER_OPENED = 'modded',
}
local SHOP_KINDS = {
  Joker = 'joker',
  Voucher = 'voucher',
  Booster = 'booster',
  Tarot = 'tarot',
  Planet = 'planet',
  Spectral = 'spectral',
  Default = 'playing_card',
  Enhanced = 'playing_card',
}

local function card_id(card)
  return card.sort_id or (card.config and card.config.card_id)
end

local function compact_table(value, depth)
  if type(value) ~= 'table' or depth <= 0 then return nil end
  local out = {}
  for key, item in pairs(value) do
    if type(key) == 'string' or type(key) == 'number' then
      local item_type = type(item)
      if item_type == 'string' or item_type == 'number' or item_type == 'boolean' then
        out[key] = item
      elseif item_type == 'table' then
        out[key] = compact_table(item, depth - 1)
      end
    end
  end
  return next(out) and out or nil
end

local function get_card_stickers(card)
  if not card then return nil end
  local stickers = {}
  if card.ability and card.ability.eternal then stickers[#stickers + 1] = 'eternal' end
  if card.ability and card.ability.perishable then stickers[#stickers + 1] = 'perishable' end
  if card.ability and card.ability.rental then stickers[#stickers + 1] = 'rental' end
  if #stickers == 0 then return nil end
  return stickers
end

local function get_card_edition(card)
  if not card or not card.edition then return nil end
  local ed = card.edition
  if ed.foil then return 'foil' end
  if ed.holo then return 'holo' end
  if ed.polychrome then return 'polychrome' end
  if ed.negative then return 'negative' end
  return nil
end

local function get_card_enhancement(card)
  if not card or not card.ability or not card.ability.name then return nil end
  local name = card.ability.name
  if name == '' or name == 'Default Base' then return nil end
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
  return enhancements[name]
end

local function clean_description_text(text)
  if type(text) ~= 'string' then return nil end
  return text
    :gsub('{C:[^}]+}', '')
    :gsub('{X:[^}]+}', '')
    :gsub('{V:[^}]+}', '')
    :gsub('{s:[^}]+}', '')
    :gsub('{}', '')
end

local function trim_text(text)
  if type(text) ~= 'string' then return nil end
  local trimmed = text:gsub('^%s+', ''):gsub('%s+$', '')
  if trimmed == '' then return nil end
  return trimmed
end

local function append_plain_text(parts, value)
  if type(value) == 'string' or type(value) == 'number' or type(value) == 'boolean' then
    parts[#parts + 1] = tostring(value)
  elseif type(value) == 'table' then
    if value.ref_table and value.ref_value and value.ref_table[value.ref_value] ~= nil then
      append_plain_text(parts, value.prefix)
      append_plain_text(parts, value.ref_table[value.ref_value])
      append_plain_text(parts, value.suffix)
    elseif value.string ~= nil then
      append_plain_text(parts, value.string)
    else
      for _, item in ipairs(value) do
        append_plain_text(parts, item)
      end
    end
  end
end

local function collect_node_text(node, parts)
  if type(node) ~= 'table' then return end
  local config = node.config
  if type(config) == 'table' then
    append_plain_text(parts, config.text)
    if type(config.object) == 'table' then
      append_plain_text(parts, config.object.string)
      if type(config.object.config) == 'table' then
        append_plain_text(parts, config.object.config.string)
        append_plain_text(parts, config.object.config.text)
      end
    end
  end
  if type(node.nodes) == 'table' then
    for _, child in ipairs(node.nodes) do
      collect_node_text(child, parts)
    end
  end
  for _, child in ipairs(node) do
    collect_node_text(child, parts)
  end
end

local function rendered_rows_to_description(rows)
  if type(rows) ~= 'table' then return nil end
  local lines = {}
  for _, row in ipairs(rows) do
    local parts = {}
    collect_node_text(row, parts)
    local line = trim_text(table.concat(parts, ''))
    if line then lines[#lines + 1] = line end
  end
  if #lines == 0 then return nil end
  return table.concat(lines, ' ')
end

local function get_rendered_card_description(card)
  if not card or type(card.generate_UIBox_ability_table) ~= 'function' then return nil end
  local ok, ui = pcall(function()
    return card:generate_UIBox_ability_table()
  end)
  if not ok or type(ui) ~= 'table' then return nil end
  return rendered_rows_to_description(ui.main)
end

local function get_card_description(card)
  local rendered = get_rendered_card_description(card)
  if rendered then return rendered end

  local center = card and card.config and card.config.center

  local loc_txt = center and center.loc_txt
  local text = loc_txt and loc_txt.text
  if type(text) == 'string' then return clean_description_text(text) end
  if type(text) ~= 'table' then return nil end

  local lines = {}
  for _, line in ipairs(text) do
    if type(line) == 'string' then
      local clean = clean_description_text(line)
      if clean then lines[#lines + 1] = clean end
    end
  end
  if #lines == 0 then return nil end
  return table.concat(lines, ' ')
end

local function serialize_playing_card(card)
  if not card then return nil end
  return {
    card_id = card_id(card),
    kind = 'playing_card',
    name = card.label or (card.base and card.base.name),
    rank = card.base and card.base.value,
    suit = card.base and card.base.suit,
    enhancement = get_card_enhancement(card),
    edition = get_card_edition(card),
    seal = card.seal,
    debuffed = card.debuff or nil,
    stickers = get_card_stickers(card),
  }
end

local function serialize_joker(card)
  if not card then return nil end
  local obj = {
    card_id = card_id(card),
    kind = 'joker',
    name = card.ability and card.ability.name,
    entity_id = card.config and card.config.center and card.config.center.key,
    rarity = card.config and card.config.center and card.config.center.rarity,
    live_description = get_card_description(card),
    sell_value = card.sell_cost,
    edition = get_card_edition(card),
    stickers = get_card_stickers(card),
    debuffed = card.debuff or nil,
    cost = card.cost,
  }
  if card.ability and type(card.ability.extra) == 'table' then
    local extras = {}
    for k, v in pairs(card.ability.extra) do
      extras[k] = v
    end
    if next(extras) then
      obj.extras = extras
    end
  end
  return obj
end

local function serialize_consumable(card)
  if not card then return nil end
  local kind = 'consumable'
  if card.ability and card.ability.set then
    local set = card.ability.set:lower()
    if set == 'tarot' or set == 'planet' or set == 'spectral' then
      kind = set
    end
  end
  return {
    card_id = card_id(card),
    kind = kind,
    name = card.ability and card.ability.name,
    entity_id = card.config and card.config.center and card.config.center.key,
    live_description = get_card_description(card),
    sell_value = card.sell_cost,
    edition = get_card_edition(card),
    stickers = get_card_stickers(card),
    cost = card.cost,
  }
end

local function serialize_shop_card(card)
  if not card then return nil end
  local set = card.config and card.config.center and card.config.center.set
  local kind = SHOP_KINDS[set] or 'unknown'

  if kind == 'playing_card' then
    local pc = serialize_playing_card(card)
    pc.cost = card.cost
    pc.sell_value = card.sell_cost
    return pc
  end

  return {
    card_id = card_id(card),
    kind = kind,
    name = card.ability and card.ability.name,
    entity_id = card.config and card.config.center and card.config.center.key,
    rarity = kind == 'joker' and card.config and card.config.center and card.config.center.rarity or nil,
    live_description = get_card_description(card),
    cost = card.cost,
    sell_value = card.sell_cost,
    edition = get_card_edition(card),
    stickers = get_card_stickers(card),
  }
end

local function compute_legal_actions()
  if not G or not G.STATE then return {} end

  local actions = {}
  local gs = G.STATE

  local function has_sellable_card()
    if G.jokers and G.jokers.cards then
      for _, card in ipairs(G.jokers.cards) do
        if card and not (card.ability and card.ability.eternal) then
          return true
        end
      end
    end
    return G.consumeables and G.consumeables.cards and #G.consumeables.cards > 0
  end

  local states = G.STATES
  local pack_state = false
  for phase in pairs(PACK_KINDS) do
    if gs == states[phase] then
      pack_state = true
      break
    end
  end

  if gs == states.SELECTING_HAND then
    actions[#actions + 1] = 'select_hand_cards'
    actions[#actions + 1] = 'sort_hand'
    if G.hand and #G.hand.highlighted > 0 then
      local hands_left = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_left or 0
      if hands_left > 0 then
        actions[#actions + 1] = 'play_hand'
      end
    end
    if G.hand and #G.hand.highlighted > 0 then
      local discards_left = G.GAME and G.GAME.current_round and G.GAME.current_round.discards_left or 0
      if discards_left > 0 then
        actions[#actions + 1] = 'discard_hand'
      end
    end
    if G.consumeables and G.consumeables.cards then
      for _, card in ipairs(G.consumeables.cards) do
        if card and card.ability and card.highlighted then
          actions[#actions + 1] = 'use_consumable'
          break
        end
      end
    end
    if G.jokers and G.jokers.cards and #G.jokers.cards > 1 then
      actions[#actions + 1] = 'reorder_jokers'
    end

  elseif gs == states.BLIND_SELECT then
    local blind_key = G.GAME and G.GAME.blind_on_deck
    local blind_ui = blind_key and G.blind_select_opts and G.blind_select_opts[string.lower(blind_key)]
    local select_button = blind_ui and blind_ui.get_UIE_by_ID and blind_ui:get_UIE_by_ID('select_blind_button')
    local round_resets = G.GAME and G.GAME.round_resets
    if G.GAME and G.GAME.round_resets and G.GAME.round_resets.blind_choices
        and (blind_key == 'Small' or blind_key == 'Big' or blind_key == 'Boss')
        and G.GAME.round_resets.blind_choices[blind_key]
        and select_button and select_button.UIBox and select_button.config and select_button.config.ref_table then
      actions[#actions + 1] = 'select_blind'
      local tag_key = round_resets.blind_tags and round_resets.blind_tags[blind_key]
      local tag_container = select_button.UIBox.get_UIE_by_ID
          and select_button.UIBox:get_UIE_by_ID('tag_container')
      if (blind_key == 'Small' or blind_key == 'Big') and tag_key and tag_container then
        actions[#actions + 1] = 'skip_blind'
      end
    end
  elseif gs == states.SHOP then
    local has_card = false
    local has_consumable = false
    if G.shop_jokers and G.shop_jokers.cards then
      for _, card in ipairs(G.shop_jokers.cards) do
        local set = card and card.config and card.config.center and card.config.center.set
        if set == 'Joker' or set == 'Default' or set == 'Enhanced' then
          has_card = true
        elseif set == 'Tarot' or set == 'Planet' or set == 'Spectral' then
          has_consumable = true
        end
      end
    end
    local has_voucher = G.shop_vouchers and G.shop_vouchers.cards and #G.shop_vouchers.cards > 0
    local has_booster = G.shop_booster and G.shop_booster.cards and #G.shop_booster.cards > 0

    if has_card then actions[#actions + 1] = 'buy_card' end
    if has_consumable then actions[#actions + 1] = 'buy_consumable' end
    if has_voucher then actions[#actions + 1] = 'buy_voucher' end
    if has_booster then actions[#actions + 1] = 'buy_booster' end
    actions[#actions + 1] = 'reroll_shop'
    actions[#actions + 1] = 'leave_shop'
    actions[#actions + 1] = 'use_consumable'
    actions[#actions + 1] = 'reorder_jokers'

  elseif pack_state then
    actions[#actions + 1] = 'select_booster_card'
    actions[#actions + 1] = 'skip_booster'

  elseif gs == states.ROUND_EVAL then
    if G.round_eval then
      actions[#actions + 1] = 'cash_out'
    end
  end

  if (gs == states.BLIND_SELECT or gs == states.SELECTING_HAND or gs == states.ROUND_EVAL or gs == states.SHOP)
      and has_sellable_card() then
    actions[#actions + 1] = 'sell_card'
  end

  return actions
end

local function get_phase_name()
  if not G or not G.STATE or not G.STATES then return 'UNKNOWN' end
  for _, phase in ipairs(PHASE_NAMES) do
    if G.STATE == G.STATES[phase] then return phase end
  end
  return 'STATE_' .. tostring(G.STATE)
end

local function compute_deck_summary()
  if not G or not G.deck or not G.deck.cards then
    return { count = 0 }
  end

  local count = #G.deck.cards
  local by_rank = {}
  local by_suit = {}
  local by_modifier = {}

  for _, card in ipairs(G.deck.cards) do
    if card.base then
      local rank = card.base.value
      local suit = card.base.suit
      if rank then by_rank[rank] = (by_rank[rank] or 0) + 1 end
      if suit then by_suit[suit] = (by_suit[suit] or 0) + 1 end
    end
    local enh = get_card_enhancement(card)
    if enh then by_modifier[enh] = (by_modifier[enh] or 0) + 1 end
  end

  return {
    count = count,
    by_rank = next(by_rank) and by_rank or nil,
    by_suit = next(by_suit) and by_suit or nil,
    by_modifier = next(by_modifier) and by_modifier or nil,
  }
end

local function snapshot_shop()
  if not G or not G.STATES or G.STATE ~= G.STATES.SHOP then return nil end

  local shop = {}

  if G.shop_jokers and G.shop_jokers.cards then
    local cards = {}
    for _, card in ipairs(G.shop_jokers.cards) do
      cards[#cards + 1] = serialize_shop_card(card)
    end
    if #cards > 0 then shop.cards = cards end
  end

  if G.shop_vouchers and G.shop_vouchers.cards then
    local vouchers = {}
    for _, card in ipairs(G.shop_vouchers.cards) do
      vouchers[#vouchers + 1] = serialize_shop_card(card)
    end
    if #vouchers > 0 then shop.vouchers = vouchers end
  end

  if G.shop_booster and G.shop_booster.cards then
    local boosters = {}
    for _, card in ipairs(G.shop_booster.cards) do
      boosters[#boosters + 1] = serialize_shop_card(card)
    end
    if #boosters > 0 then shop.boosters = boosters end
  end

  shop.reroll_cost = G.GAME and G.GAME.current_round and G.GAME.current_round.reroll_cost
  shop.dollars = G.GAME and G.GAME.dollars
  shop.slots = G.GAME and G.GAME.shop and G.GAME.shop.joker_max

  return shop
end

local function snapshot_pack()
  if not G or not G.STATES then return nil end
  local kind
  for phase, phase_kind in pairs(PACK_KINDS) do
    if G.STATE == G.STATES[phase] then
      kind = phase_kind
      break
    end
  end
  if not kind then return nil end

  local pack = { kind = kind }

  if G.pack_cards then
    pack.picks_remaining = G.GAME and G.GAME.pack_choices or 1
  end

  if G.pack_cards and G.pack_cards.cards then
    local options = {}
    for _, card in ipairs(G.pack_cards.cards) do
      if card.config and card.config.center then
        local set = card.config.center.set
        if set == 'Joker' then
          options[#options + 1] = serialize_joker(card)
        elseif set == 'Default' or set == 'Enhanced' then
          options[#options + 1] = serialize_playing_card(card)
        else
          options[#options + 1] = serialize_consumable(card)
        end
      else
        options[#options + 1] = serialize_playing_card(card)
      end
    end
    if #options > 0 then pack.options = options end
  end

  return pack
end

local function snapshot_tags()
  if not G or not G.GAME or not G.GAME.tags then return nil end
  local tags = {}
  for _, tag in ipairs(G.GAME.tags) do
    tags[#tags + 1] = {
      name = tag.name,
      entity_id = tag.key,
    }
  end
  if #tags == 0 then return nil end
  return tags
end

local function snapshot_skip_reward(tag_key, blind_key)
  local tag = G.P_TAGS and G.P_TAGS[tag_key]
  local config = tag and tag.config or {}
  local reward = {
    entity_id = tag_key,
    name = tag and tag.name or tag_key,
    config = compact_table(config, 3),
  }

  if tag_key == 'tag_investment' then
    reward.dollars = config.dollars
  elseif tag_key == 'tag_handy' then
    reward.dollars = (config.dollars_per_hand or 0) * (G.GAME.hands_played or 0)
  elseif tag_key == 'tag_garbage' then
    reward.dollars = (config.dollars_per_discard or 0) * (G.GAME.unused_discards or 0)
  elseif tag_key == 'tag_skip' then
    reward.dollars = (config.skip_bonus or 0) * ((G.GAME.skips or 0) + 1)
  elseif tag_key == 'tag_economy' then
    reward.dollars = math.min(config.max or 0, math.max(0, G.GAME.dollars or 0))
  elseif tag_key == 'tag_orbital' then
    local ante = G.GAME.round_resets and G.GAME.round_resets.ante
    local choices = G.GAME.orbital_choices
    reward.poker_hand = ante and choices and choices[ante] and choices[ante][blind_key] or nil
  end

  return reward
end

local function snapshot_blind_selection()
  local round_resets = G and G.GAME and G.GAME.round_resets
  if not round_resets or not round_resets.blind_choices then return nil end

  local selection = { current = G.GAME.blind_on_deck }
  local has_choice = false
  for _, blind_key in ipairs({ 'Small', 'Big', 'Boss' }) do
    local blind_id = round_resets.blind_choices[blind_key]
    if blind_id then
      local blind = G.P_BLINDS and G.P_BLINDS[blind_id]
      local choice = {
        blind_id = blind_id,
        name = blind and blind.name or blind_id,
        state = round_resets.blind_states and round_resets.blind_states[blind_key] or nil,
      }

      local tag_key = round_resets.blind_tags and round_resets.blind_tags[blind_key]
      if (blind_key == 'Small' or blind_key == 'Big') and tag_key then
        choice.skip_reward = snapshot_skip_reward(tag_key, blind_key)
      end

      selection[blind_key] = choice
      has_choice = true
    end
  end

  return has_choice and selection or nil
end

local function snapshot_hand_levels()
  if not G or not G.GAME or not G.GAME.hands then return nil end
  local levels = {}
  for hand_name, data in pairs(G.GAME.hands) do
    if data.visible then
      levels[#levels + 1] = {
        name = hand_name,
        level = data.level,
        chips = data.chips,
        mult = data.mult,
        played = data.played,
      }
    end
  end
  if #levels == 0 then return nil end
  table.sort(levels, function(a, b) return a.name < b.name end)
  return levels
end

local function snapshot()
  if not G then return nil end

  local payload = {}

  payload.g_state = G.STATE
  payload.phase = get_phase_name()
  payload.legal_actions = compute_legal_actions()

  payload.money = G.GAME and G.GAME.dollars
  payload.bankrupt_at = G.GAME and G.GAME.bankrupt_at
  payload.ante = G.GAME and G.GAME.round_resets and G.GAME.round_resets.ante

  if G.GAME and G.GAME.blind then
    local b = G.GAME.blind
    payload.blind = {
      name = b.name,
      chips = b.chips,
      debuff = b.debuff or nil,
      block_play = b.block_play or nil,
    }
  end

  if G.GAME and G.GAME.current_round then
    local cr = G.GAME.current_round
    payload.current_round = {
      hands_left = cr.hands_left,
      discards_left = cr.discards_left,
      hands_played = cr.hands_played,
      discards_used = cr.discards_used,
      dollars = cr.dollars,
      reroll_cost = cr.reroll_cost,
      free_rerolls = cr.free_rerolls and cr.free_rerolls > 0 and cr.free_rerolls or nil,
    }
  end

  payload.hand_size = G.hand and G.hand.config and G.hand.config.card_limit
  payload.joker_slots = G.jokers and G.jokers.config and G.jokers.config.card_limit
  payload.consumable_slots = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit

  if G.hand and G.hand.cards then
    local hand = {}
    for _, card in ipairs(G.hand.cards) do
      hand[#hand + 1] = serialize_playing_card(card)
    end
    if #hand > 0 then payload.hand = hand end
  end

  if G.hand and G.hand.highlighted and #G.hand.highlighted > 0 then
    local selected = {}
    for _, card in ipairs(G.hand.highlighted) do
      selected[#selected + 1] = card_id(card)
    end
    payload.selected_hand_card_ids = selected
  end

  if G.jokers and G.jokers.cards then
    local jokers = {}
    for _, card in ipairs(G.jokers.cards) do
      local set = card and card.config and card.config.center and card.config.center.set
      if set == nil or set == 'Joker' then
        jokers[#jokers + 1] = serialize_joker(card)
      end
    end
    if #jokers > 0 then payload.jokers = jokers end
  end

  if G.consumeables and G.consumeables.cards then
    local consumables = {}
    for _, card in ipairs(G.consumeables.cards) do
      consumables[#consumables + 1] = serialize_consumable(card)
    end
    if #consumables > 0 then payload.consumables = consumables end
  end

  payload.deck_summary = compute_deck_summary()

  if G.discard and G.discard.cards then
    payload.discard_summary = { count = #G.discard.cards }
  end

  payload.shop = snapshot_shop()

  payload.pack = snapshot_pack()

  payload.tags = snapshot_tags()

  payload.blind_selection = snapshot_blind_selection()

  if G.GAME and G.GAME.used_vouchers then
    local vouchers = {}
    for k, v in pairs(G.GAME.used_vouchers) do
      if v then
        vouchers[#vouchers + 1] = k
      end
    end
    if #vouchers > 0 then
      table.sort(vouchers)
      payload.used_vouchers = vouchers
    end
  end

  payload.hand_levels = snapshot_hand_levels()

  if G.GAME and G.GAME.challenge and G.GAME.challenge ~= '' then
    payload.active_challenge = G.GAME.challenge
  end

  if G.GAME and G.GAME.banned_keys then
    local disabled = {}
    for k, v in pairs(G.GAME.banned_keys) do
      if v then disabled[#disabled + 1] = k end
    end
    if #disabled > 0 then
      table.sort(disabled)
      payload.disabled_entities = disabled
    end
  end

  if G.GAME and G.GAME.round_resets and G.GAME.round_resets.ante and G.GAME.round_resets.ante > 8 then
    payload.endless_mode = true
  end

  return payload
end

function State.get_state_envelope()
  seq = seq + 1
  return {
    protocol_version = PROTOCOL_VERSION,
    seq = seq,
    payload = snapshot(),
  }
end

return State
