local ENTITY_TYPES = {
  Joker = 'joker',
  Tarot = 'tarot',
  Planet = 'planet',
  Spectral = 'spectral',
  Voucher = 'voucher',
  Booster = 'booster',
  Blind = 'blind',
}

local function compact_table(value, depth)
  if type(value) ~= 'table' then return value end
  if depth <= 0 then return nil end
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

local function stickers(card)
  local values = {}
  if card.ability and card.ability.eternal then values[#values + 1] = 'eternal' end
  if card.ability and card.ability.perishable then values[#values + 1] = 'perishable' end
  if card.ability and card.ability.rental then values[#values + 1] = 'rental' end
  return #values > 0 and values or nil
end

local function edition(card)
  if not card.edition then return nil end
  if card.edition.foil then return 'foil' end
  if card.edition.holo then return 'holo' end
  if card.edition.polychrome then return 'polychrome' end
  if card.edition.negative then return 'negative' end
end

local function serialize_center(center)
  local set = center.set
  local loc_txt = center.loc_txt or {}
  return {
    id = center.key,
    type = ENTITY_TYPES[set] or (set and tostring(set):lower()),
    name = loc_txt.name or center.name or center.key,
    game_name = center.name,
    set = set,
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

local function append_matches(matches, area, location, key)
  if not area or not area.cards then return end
  for _, card in ipairs(area.cards) do
    local center_key = card.config and card.config.center and card.config.center.key
    if center_key == key then
      matches[#matches + 1] = {
        card_id = card.sort_id or (card.config and card.config.card_id),
        location = location,
        name = card.ability and card.ability.name,
        sell_value = card.sell_cost,
        cost = card.cost,
        edition = edition(card),
        stickers = stickers(card),
        debuffed = card.debuff or nil,
        runtime_fields = card.ability and compact_table(card.ability.extra, 3) or nil,
      }
    end
  end
end

local function live_matches(key)
  local matches = {}
  append_matches(matches, G.jokers, 'jokers', key)
  append_matches(matches, G.consumeables, 'consumables', key)
  append_matches(matches, G.hand, 'hand', key)
  append_matches(matches, G.shop_jokers, 'shop.jokers', key)
  append_matches(matches, G.shop_vouchers, 'shop.vouchers', key)
  append_matches(matches, G.shop_booster, 'shop.boosters', key)
  append_matches(matches, G.pack_cards, 'pack.options', key)
  return #matches > 0 and matches or nil
end

return function(args)
  if not G or not G.P_CENTERS then
    return { ok = false, error_code = 'GAME_NOT_RUNNING', error_message = 'Game prototypes are unavailable' }
  end

  local records = {}
  for key, center in pairs(G.P_CENTERS) do
    if not args.id or args.id == key then
      local record = serialize_center(center)
      record.live_instances = live_matches(key)
      records[#records + 1] = record
    end
  end
  table.sort(records, function(a, b) return a.id < b.id end)

  local items = {}
  for index = args.offset + 1, math.min(args.offset + args.limit, #records) do
    items[#items + 1] = records[index]
  end
  local next_offset = args.offset + args.limit
  local has_more = next_offset < #records
  return {
    ok = true,
    data = {
      items = items,
      total = #records,
      count = #items,
      offset = args.offset,
      has_more = has_more,
      next_offset = has_more and next_offset or nil,
      source = 'runtime:G.P_CENTERS',
    },
  }
end
