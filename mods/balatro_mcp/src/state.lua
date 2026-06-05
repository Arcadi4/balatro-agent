--- Balatro MCP Bridge: State Snapshots
--- Produces game state envelopes on demand.
--- Protocol: pull-based IPC with monotonic seq.

local state = {}

-- Constants
local PROTOCOL_VERSION = 1

-- Module state
state.seq = 0

-------------------------------------------------------------------------------
-- JSON encoding (use SMODS.JSON if available, else love.data or fallback)
-------------------------------------------------------------------------------

local json_encode
do
  -- Try SMODS-provided JSON first
  if SMODS and SMODS.JSON and SMODS.JSON.encode then
    json_encode = SMODS.JSON.encode
  elseif JSON and JSON.encode then
    json_encode = JSON.encode
  else
    -- Minimal JSON encoder for Lua tables (strings, numbers, booleans, nil, arrays, objects)
    local encode_value

    local function encode_string(s)
      s = s:gsub('\\', '\\\\')
      s = s:gsub('"', '\\"')
      s = s:gsub('\n', '\\n')
      s = s:gsub('\r', '\\r')
      s = s:gsub('\t', '\\t')
      return '"' .. s .. '"'
    end

    local function is_array(t)
      local i = 0
      for _ in pairs(t) do
        i = i + 1
        if t[i] == nil then return false end
      end
      return true
    end

    local function encode_array(arr)
      local parts = {}
      for i = 1, #arr do
        parts[i] = encode_value(arr[i])
      end
      return '[' .. table.concat(parts, ',') .. ']'
    end

    local function encode_object(obj)
      -- Sort keys for canonical output
      local keys = {}
      for k in pairs(obj) do
        if type(k) == 'string' then
          keys[#keys + 1] = k
        end
      end
      table.sort(keys)
      local parts = {}
      for i = 1, #keys do
        local k = keys[i]
        local v = obj[k]
        if v ~= nil then
          parts[#parts + 1] = encode_string(k) .. ':' .. encode_value(v)
        end
      end
      return '{' .. table.concat(parts, ',') .. '}'
    end

    encode_value = function(v)
      local t = type(v)
      if v == nil then
        return 'null'
      elseif t == 'boolean' then
        return v and 'true' or 'false'
      elseif t == 'number' then
        if v ~= v then return 'null' end -- NaN
        if v == math.huge or v == -math.huge then return 'null' end
        if v == math.floor(v) and v >= -2^53 and v <= 2^53 then
          return string.format('%d', v)
        end
        return string.format('%.17g', v)
      elseif t == 'string' then
        return encode_string(v)
      elseif t == 'table' then
        if is_array(v) then
          return encode_array(v)
        else
          return encode_object(v)
        end
      else
        return 'null'
      end
    end

    json_encode = function(val)
      return encode_value(val)
    end
  end
end

-- Card serialization helpers
-------------------------------------------------------------------------------

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

local function get_card_seal(card)
  if not card or not card.seal then return nil end
  return card.seal
end

local function get_card_enhancement(card)
  if not card or not card.ability or not card.ability.name then return nil end
  local name = card.ability.name
  -- Base cards have no enhancement
  if name == '' or name == 'Default Base' then return nil end
  -- Known enhancements
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
  local obj = {
    card_id = card.sort_id or (card.config and card.config.card_id),
    kind = 'playing_card',
    name = card.label or (card.base and card.base.name),
    rank = card.base and card.base.value,
    suit = card.base and card.base.suit,
    enhancement = get_card_enhancement(card),
    edition = get_card_edition(card),
    seal = get_card_seal(card),
    debuffed = card.debuff or nil,
    stickers = get_card_stickers(card),
  }
  -- Omit false debuffed
  if obj.debuffed == false then obj.debuffed = nil end
  return obj
end

local function serialize_joker(card)
  if not card then return nil end
  local obj = {
    card_id = card.sort_id or (card.config and card.config.card_id),
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
  if obj.debuffed == false then obj.debuffed = nil end
  -- extras: per-joker dynamic fields from ability
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
  local obj = {
    card_id = card.sort_id or (card.config and card.config.card_id),
    kind = kind,
    name = card.ability and card.ability.name,
    entity_id = card.config and card.config.center and card.config.center.key,
    live_description = get_card_description(card),
    sell_value = card.sell_cost,
    edition = get_card_edition(card),
    stickers = get_card_stickers(card),
    cost = card.cost,
  }
  return obj
end

local function serialize_shop_card(card)
  if not card then return nil end
  -- Determine kind from center set
  local kind = 'unknown'
  if card.config and card.config.center then
    local set = card.config.center.set
    if set == 'Joker' then kind = 'joker'
    elseif set == 'Voucher' then kind = 'voucher'
    elseif set == 'Booster' then kind = 'booster'
    elseif set == 'Tarot' then kind = 'tarot'
    elseif set == 'Planet' then kind = 'planet'
    elseif set == 'Spectral' then kind = 'spectral'
    end
  end

  local obj = {
    card_id = card.sort_id or (card.config and card.config.card_id),
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
  return obj
end

-------------------------------------------------------------------------------
-- Legal actions computation based on G.STATE
-------------------------------------------------------------------------------

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

  -- G.STATES constants (from Balatro source)
  local STATES = G.STATES or {}
  local SELECTING_HAND = STATES.SELECTING_HAND or 13
  local BLIND_SELECT = STATES.BLIND_SELECT or 11
  local SHOP = STATES.SHOP or 16
  local TAROT_PACK = STATES.TAROT_PACK or 17
  local PLANET_PACK = STATES.PLANET_PACK or 18
  local SPECTRAL_PACK = STATES.SPECTRAL_PACK or 19
  local STANDARD_PACK = STATES.STANDARD_PACK or 20
  local BUFFOON_PACK = STATES.BUFFOON_PACK or 21
  local ROUND_EVAL = STATES.ROUND_EVAL or 15
  local SMODS_BOOSTER_OPENED = STATES.SMODS_BOOSTER_OPENED or 22

  -- Pack states
  local pack_states = {
    [TAROT_PACK] = true,
    [PLANET_PACK] = true,
    [SPECTRAL_PACK] = true,
    [STANDARD_PACK] = true,
    [BUFFOON_PACK] = true,
  }
  if SMODS_BOOSTER_OPENED then
    pack_states[SMODS_BOOSTER_OPENED] = true
  end

  if gs == SELECTING_HAND then
    actions[#actions + 1] = 'select_hand_cards'
    actions[#actions + 1] = 'sort_hand'
    -- Can play if cards highlighted and hands left
    if G.hand and #G.hand.highlighted > 0 then
      local hands_left = G.GAME and G.GAME.current_round and G.GAME.current_round.hands_left or 0
      if hands_left > 0 then
        actions[#actions + 1] = 'play_hand'
      end
    end
    -- Can discard if cards highlighted and discards left
    if G.hand and #G.hand.highlighted > 0 then
      local discards_left = G.GAME and G.GAME.current_round and G.GAME.current_round.discards_left or 0
      if discards_left > 0 then
        actions[#actions + 1] = 'discard_hand'
      end
    end
    -- Can use consumable
    if G.consumeables and G.consumeables.cards then
      for _, card in ipairs(G.consumeables.cards) do
        if card and card.ability and card.highlighted then
          actions[#actions + 1] = 'use_consumable'
          break
        end
      end
    end
    -- Can reorder jokers
    if G.jokers and G.jokers.cards and #G.jokers.cards > 1 then
      actions[#actions + 1] = 'reorder_jokers'
    end

  elseif gs == BLIND_SELECT then
    local blind_key = G.GAME and G.GAME.blind_on_deck
    local blind_ui = blind_key and G.blind_select_opts and G.blind_select_opts[string.lower(blind_key)]
    local select_button = blind_ui and blind_ui.get_UIE_by_ID and blind_ui:get_UIE_by_ID('select_blind_button')
    if G.GAME and G.GAME.round_resets and G.GAME.round_resets.blind_choices
        and (blind_key == 'Small' or blind_key == 'Big' or blind_key == 'Boss')
        and G.GAME.round_resets.blind_choices[blind_key]
        and select_button and select_button.UIBox and select_button.config and select_button.config.ref_table then
      actions[#actions + 1] = 'select_blind'
      actions[#actions + 1] = 'skip_blind'
    end
    -- Reroll in blind select requires Retcon voucher
    if G.GAME and G.GAME.used_vouchers and G.GAME.used_vouchers.v_retcon then
      actions[#actions + 1] = 'reroll_shop'
    end

  elseif gs == SHOP then
    actions[#actions + 1] = 'buy_card'
    actions[#actions + 1] = 'sell_card'
    actions[#actions + 1] = 'reroll_shop'
    actions[#actions + 1] = 'leave_shop'
    actions[#actions + 1] = 'use_consumable'
    actions[#actions + 1] = 'buy_and_use_card'
    actions[#actions + 1] = 'reorder_jokers'
    -- Open booster if boosters in shop
    if G.shop_booster and G.shop_booster.cards and #G.shop_booster.cards > 0 then
      actions[#actions + 1] = 'open_booster'
    end

  elseif pack_states[gs] then
    actions[#actions + 1] = 'select_booster_card'
    actions[#actions + 1] = 'skip_booster'

  elseif gs == ROUND_EVAL then
    actions[#actions + 1] = 'cash_out'
  end

  if (gs == BLIND_SELECT or gs == SELECTING_HAND or gs == ROUND_EVAL or gs == SHOP) and has_sellable_card() then
    actions[#actions + 1] = 'sell_card'
  end

  return actions
end

-------------------------------------------------------------------------------
-- Phase name mapping
-------------------------------------------------------------------------------

local function get_phase_name()
  if not G or not G.STATE then return 'UNKNOWN' end
  local gs = G.STATE
  local STATES = G.STATES or {}

  local phase_map = {
    [STATES.SELECTING_HAND or 13] = 'SELECTING_HAND',
    [STATES.BLIND_SELECT or 11] = 'BLIND_SELECT',
    [STATES.SHOP or 16] = 'SHOP',
    [STATES.TAROT_PACK or 17] = 'TAROT_PACK',
    [STATES.PLANET_PACK or 18] = 'PLANET_PACK',
    [STATES.SPECTRAL_PACK or 19] = 'SPECTRAL_PACK',
    [STATES.STANDARD_PACK or 20] = 'STANDARD_PACK',
    [STATES.BUFFOON_PACK or 21] = 'BUFFOON_PACK',
    [STATES.ROUND_EVAL or 15] = 'ROUND_EVAL',
    [STATES.HAND_PLAYED or 14] = 'HAND_PLAYED',
    [STATES.DRAW_TO_HAND or 12] = 'DRAW_TO_HAND',
    [STATES.NEW_ROUND or 10] = 'NEW_ROUND',
    [STATES.GAME_OVER or 7] = 'GAME_OVER',
    [STATES.MENU or 1] = 'MENU',
    [STATES.SPLASH or 0] = 'SPLASH',
  }
  if STATES.SMODS_BOOSTER_OPENED then
    phase_map[STATES.SMODS_BOOSTER_OPENED] = 'SMODS_BOOSTER_OPENED'
  end

  return phase_map[gs] or ('STATE_' .. tostring(gs))
end

-------------------------------------------------------------------------------
-- Deck summary
-------------------------------------------------------------------------------

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

-------------------------------------------------------------------------------
-- Shop snapshot
-------------------------------------------------------------------------------

local function snapshot_shop()
  if not G or G.STATE ~= (G.STATES and G.STATES.SHOP or 16) then return nil end

  local shop = {}

  -- Shop cards (Jokers and consumables share this market row)
  if G.shop_jokers and G.shop_jokers.cards then
    local cards = {}
    for _, card in ipairs(G.shop_jokers.cards) do
      cards[#cards + 1] = serialize_shop_card(card)
    end
    if #cards > 0 then shop.cards = cards end
  end

  -- Shop vouchers
  if G.shop_vouchers and G.shop_vouchers.cards then
    local vouchers = {}
    for _, card in ipairs(G.shop_vouchers.cards) do
      vouchers[#vouchers + 1] = serialize_shop_card(card)
    end
    if #vouchers > 0 then shop.vouchers = vouchers end
  end

  -- Shop boosters
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

-------------------------------------------------------------------------------
-- Pack snapshot
-------------------------------------------------------------------------------

local function snapshot_pack()
  if not G then return nil end
  local STATES = G.STATES or {}
  local pack_states = {
    [STATES.TAROT_PACK or 17] = 'tarot',
    [STATES.PLANET_PACK or 18] = 'planet',
    [STATES.SPECTRAL_PACK or 19] = 'spectral',
    [STATES.STANDARD_PACK or 20] = 'standard',
    [STATES.BUFFOON_PACK or 21] = 'buffoon',
  }
  if STATES.SMODS_BOOSTER_OPENED then
    pack_states[STATES.SMODS_BOOSTER_OPENED] = 'modded'
  end

  local kind = pack_states[G.STATE]
  if not kind then return nil end

  local pack = { kind = kind }

  -- Picks remaining
  if G.pack_cards then
    pack.picks_remaining = G.GAME and G.GAME.pack_choices or 1
  end

  -- Options (cards in the pack)
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

-------------------------------------------------------------------------------
-- Tags snapshot
-------------------------------------------------------------------------------

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

-------------------------------------------------------------------------------
-- Hand levels snapshot
-------------------------------------------------------------------------------

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
  -- Sort for determinism
  table.sort(levels, function(a, b) return a.name < b.name end)
  return levels
end

-------------------------------------------------------------------------------
-- Main snapshot function
-------------------------------------------------------------------------------

function state.snapshot()
  if not G then return nil end

  local payload = {}

  -- Core state
  payload.g_state = G.STATE
  payload.phase = get_phase_name()
  payload.legal_actions = compute_legal_actions()

  -- Economy
  payload.money = G.GAME and G.GAME.dollars
  payload.bankrupt_at = G.GAME and G.GAME.bankrupt_at
  payload.ante = G.GAME and G.GAME.round_resets and G.GAME.round_resets.ante

  -- Blind info
  if G.GAME and G.GAME.blind then
    local b = G.GAME.blind
    payload.blind = {
      name = b.name,
      chips = b.chips,
      debuff = b.debuff or nil,
      block_play = b.block_play or nil,
    }
    -- Omit false values
    if payload.blind.debuff == false then payload.blind.debuff = nil end
    if payload.blind.block_play == false then payload.blind.block_play = nil end
  end

  -- Current round
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

  -- Slots
  payload.hand_size = G.hand and G.hand.config and G.hand.config.card_limit
  payload.joker_slots = G.jokers and G.jokers.config and G.jokers.config.card_limit
  payload.consumable_slots = G.consumeables and G.consumeables.config and G.consumeables.config.card_limit

  -- Hand cards
  if G.hand and G.hand.cards then
    local hand = {}
    for _, card in ipairs(G.hand.cards) do
      hand[#hand + 1] = serialize_playing_card(card)
    end
    if #hand > 0 then payload.hand = hand end
  end

  -- Selected hand card IDs
  if G.hand and G.hand.highlighted and #G.hand.highlighted > 0 then
    local selected = {}
    for _, card in ipairs(G.hand.highlighted) do
      selected[#selected + 1] = card.sort_id or (card.config and card.config.card_id)
    end
    payload.selected_hand_card_ids = selected
  end

  -- Jokers
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

  -- Consumables
  if G.consumeables and G.consumeables.cards then
    local consumables = {}
    for _, card in ipairs(G.consumeables.cards) do
      consumables[#consumables + 1] = serialize_consumable(card)
    end
    if #consumables > 0 then payload.consumables = consumables end
  end

  -- Deck summary
  payload.deck_summary = compute_deck_summary()

  -- Discard summary
  if G.discard and G.discard.cards then
    payload.discard_summary = { count = #G.discard.cards }
  end

  -- Shop
  payload.shop = snapshot_shop()

  -- Pack
  payload.pack = snapshot_pack()

  -- Tags
  payload.tags = snapshot_tags()

  -- Used vouchers
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

  -- Hand levels
  payload.hand_levels = snapshot_hand_levels()

  -- Challenge
  if G.GAME and G.GAME.challenge and G.GAME.challenge ~= '' then
    payload.active_challenge = G.GAME.challenge
  end

  -- Disabled entities (from challenge)
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

  -- Endless mode
  if G.GAME and G.GAME.round_resets and G.GAME.round_resets.ante and G.GAME.round_resets.ante > 8 then
    payload.endless_mode = true
  end

  return payload
end

-------------------------------------------------------------------------------
-- On-demand state envelope
-------------------------------------------------------------------------------

function state.get_state_envelope()
  state.seq = state.seq + 1
  return {
    protocol_version = PROTOCOL_VERSION,
    seq = state.seq,
    payload = state.snapshot(),
  }
end

-------------------------------------------------------------------------------
-- Accessors for testing/debugging
-------------------------------------------------------------------------------

function state.get_seq()
  return state.seq
end

return state
