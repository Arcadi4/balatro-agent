local GameControls = {}

local card_ids
local get_decision_surface

function GameControls.configure(ids, decision_surface)
  card_ids = ids
  get_decision_surface = decision_surface
end

local ACTION_FOR_GUARD = {
  can_play = 'play_cards_from_highlighted',
  can_discard = 'discard_cards_from_highlighted',
  can_sell_card = 'sell_card',
  can_select_card = 'use_card',
  can_select_from_booster = 'use_card',
  can_use_consumeable = 'use_card',
  can_skip_booster = 'skip_booster',
  can_reroll = 'reroll_shop',
  reroll_boss_button = 'reroll_boss',
}

function GameControls.can_accept_input()
  if not G or not G.CONTROLLER then return false end
  if G.CONTROLLER.locked then return false end
  for _, locked in pairs(G.CONTROLLER.locks or {}) do
    if locked then return false end
  end
  if G.screenwipe or G.OVERLAY_MENU then return false end
  if G.SETTINGS and G.SETTINGS.paused then return false end
  if G.GAME and (G.GAME.STOP_USE or 0) > 0 then return false end
  return true
end

local function find_in_tree(node, action, seen)
  if type(node) ~= 'table' or seen[node] then return nil end
  seen[node] = true
  local config = node.config
  if config and (config.button == action or ACTION_FOR_GUARD[config.func] == action) then
    return node
  end
  for _, child in pairs(node.children or {}) do
    local found = find_in_tree(child, action, seen)
    if found then return found end
    local object = child.config and child.config.object
    if type(object) == 'table' and object.UIRoot then
      found = find_in_tree(object.UIRoot, action, seen)
      if found then return found end
    end
  end
  return nil
end

function GameControls.find_action_button(root, action)
  if type(root) ~= 'table' or not action then return nil end
  return find_in_tree(root.UIRoot or root, action, {})
end

local function control_is_interactable(button)
  if not button or not button.config or not button.states or not button.states.visible then return false end
  if button.under_overlay or button.disable_button or button.config.button_delay then return false end
  if button.UIBox and button.UIBox.states and not button.UIBox.states.visible then return false end
  if button.last_clicked and button.last_clicked + 0.1 >= G.TIMERS.REAL then return false end
  local parent = button.parent
  while parent and parent ~= button.UIBox do
    if parent.states and not parent.states.visible then return false end
    if parent.under_overlay then return false end
    parent = parent.parent
  end
  return true
end

function GameControls.action_button_is_enabled(button, action, allow_modal_overlay)
  if not button or not button.config then return false end
  if allow_modal_overlay then
    if not G or not G.CONTROLLER or G.CONTROLLER.locked or G.screenwipe or not G.OVERLAY_MENU then return false end
    for _, locked in pairs(G.CONTROLLER.locks or {}) do
      if locked then return false end
    end
  elseif not GameControls.can_accept_input() then
    return false
  end
  local guard = button.config.func
  if guard then
    if not G.FUNCS or type(G.FUNCS[guard]) ~= 'function' then return false end
    local ok = pcall(G.FUNCS[guard], button)
    if not ok then return false end
  end
  return button.config.button == action and control_is_interactable(button)
    and G.FUNCS and type(G.FUNCS[action]) == 'function' or false
end

function GameControls.play_hand_button()
  return G.buttons and GameControls.find_action_button(G.buttons, 'play_cards_from_highlighted') or nil
end

function GameControls.discard_hand_button()
  return G.buttons and GameControls.find_action_button(G.buttons, 'discard_cards_from_highlighted') or nil
end

function GameControls.hand_controls_ready()
  if not GameControls.can_accept_input() or not G.STATES or G.STATE ~= G.STATES.SELECTING_HAND then return false end
  return control_is_interactable(GameControls.play_hand_button())
    and control_is_interactable(GameControls.discard_hand_button())
end

-- Leaving the shop is only safe once the box has reached its slot: vanilla
-- queues a non-cancellable event that dereferences G.shop on a timer until it
-- lands, and teardown before then crashes the game. Both the leave gate and
-- the advertised legal actions read this so they cannot disagree.
function GameControls.shop_ready()
  if not G or not G.STATES or G.STATE ~= G.STATES.SHOP then return false end
  local shop = G.shop
  if not (shop and shop.T and shop.VT) then return false end
  if math.abs(shop.T.y - shop.VT.y) >= 3 then return false end
  return GameControls.action_button_is_enabled(GameControls.find_action_button(shop, 'toggle_shop'), 'toggle_shop')
end

function GameControls.boss_reroll_button()
  if not G or not G.STATES or G.STATE ~= G.STATES.BLIND_SELECT or not G.blind_prompt_box then return nil end
  return GameControls.find_action_button(G.blind_prompt_box, 'reroll_boss')
end

function GameControls.consumable_can_be_used(card)
  return card and type(card.can_use_consumeable) == 'function' and card:can_use_consumeable() or false
end

function GameControls.card_can_be_sold(card, decision_surface)
  if type(card) ~= 'table' then return false, 'unknown_card' end
  if not G or not G.STAGE or not G.STAGES or G.STAGE ~= G.STAGES.RUN then return false, 'no_run' end
  if not G.GAME then return false, 'no_run' end
  if G.STATE == G.STATES.GAME_OVER then return false, 'game_over' end
  if card.area ~= G.jokers and card.area ~= G.consumeables then return false, 'not_owned' end
  if card_ids and card_ids.hidden(card.area, card) then return false, 'hidden' end
  local live_surface = decision_surface
  if live_surface == nil then live_surface = get_decision_surface and get_decision_surface() or nil end
  if not live_surface then return false, 'no_screen' end
  if not GameControls.can_accept_input() then return false, 'input_locked' end
  if type(card.can_sell_card) ~= 'function' then return false, 'refused' end
  if not card:can_sell_card() then return false, 'refused' end
  return true
end

-- Card:highlight builds the game's card control, including modded pack selection.
function GameControls.ensure_card_action_button(card, action)
  local created = not (card.children and card.children.use_button)
  local previous = card.highlighted
  if created then card:highlight(true) end
  return GameControls.find_action_button(card.children and card.children.use_button, action), created, previous
end

function GameControls.remove_created_card_action_button(card, created, previous)
  if not created then return end
  local box = card.children and card.children.use_button
  if box then box:remove(); card.children.use_button = nil end
  card.highlighted = previous
end

return GameControls
