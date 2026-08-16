local CardIds = {}
local hidden_ids = setmetatable({}, { __mode = 'k' })
local layouts = setmetatable({}, { __mode = 'k' })
local next_hidden_id = 0

local function sha256_hex(value)
  assert(love and love.data and love.data.hash and love.data.encode, 'SHA-256 support is required')
  local digest = love.data.hash('sha256', value)
  return love.data.encode('string', 'hex', digest)
end

local entropy = table.concat({
  tostring({}),
  tostring(love.timer and love.timer.getTime() or os.time()),
  tostring(os.time()),
})
local session_secret = sha256_hex(entropy)

local function internal_id(card)
  return card and (card.sort_id or (card.config and card.config.card_id))
end

function CardIds.hidden(area, card)
  return card and (card.facing == 'back' or card.sprite_facing == 'back')
    and G and (area == G.hand or area == G.jokers) or false
end

local function new_hidden_id()
  next_hidden_id = next_hidden_id + 1
  local token = sha256_hex(session_secret .. ':' .. tostring(next_hidden_id))
  return 'hidden-card-' .. token
end

function CardIds.sync(area)
  if not area or not area.cards or not G or (area ~= G.hand and area ~= G.jokers) then return end
  local previous = layouts[area]
  local changed = not previous or #previous ~= #area.cards
  if not changed then
    for index, card in ipairs(area.cards) do
      if previous[index] ~= card then
        changed = true
        break
      end
    end
  end
  if changed and previous then
    for _, card in ipairs(previous) do hidden_ids[card] = nil end
    for _, card in ipairs(area.cards) do hidden_ids[card] = nil end
  end
  local current = {}
  for index, card in ipairs(area.cards) do current[index] = card end
  layouts[area] = current
end

function CardIds.public(area, card)
  if not CardIds.hidden(area, card) then
    hidden_ids[card] = nil
    return internal_id(card)
  end
  local id = hidden_ids[card]
  if not id then
    id = new_hidden_id()
    hidden_ids[card] = id
  end
  return id
end

function CardIds.resolve(area, target_id)
  if not area or not area.cards then return nil end
  CardIds.sync(area)
  local target = tostring(target_id)
  for _, card in ipairs(area.cards) do
    local id = CardIds.public(area, card)
    if id ~= nil and tostring(id) == target then return card end
  end
  return nil
end

function CardIds.release(card)
  hidden_ids[card] = nil
end

function CardIds.update()
  if not G then return end
  for _, area in ipairs({ G.hand, G.jokers }) do
    if area and area.cards then
      CardIds.sync(area)
      for _, card in ipairs(area.cards) do
        if not CardIds.hidden(area, card) then hidden_ids[card] = nil end
      end
    end
  end
end

return CardIds
