local Commands = {}

local actions
local jsonrpc
local socket
local pending_responses = {}
local bridge_generation = 0

local function current_score()
  return G and G.GAME and G.GAME.chips or 0
end

local function current_hands_played()
  return G and G.GAME and G.GAME.current_round and G.GAME.current_round.hands_played or 0
end

local function blind_chips()
  return G and G.GAME and G.GAME.blind and G.GAME.blind.chips or nil
end

local function queue_deferred_response(result, request_id)
  pending_responses[#pending_responses + 1] = {
    data = result.data or {},
    deferred = result.deferred,
    started_at = love.timer.getTime(),
    timeout_seconds = result.timeout_seconds or 10,
    request_id = request_id,
    saw_hand_played = false,
  }
end

local function send_pending_result(pending, result)
  jsonrpc.send_action_result(pending.request_id, result)
end
local function finish_play_hand(pending, timed_out)
  local before = pending.data.score_before or 0
  local after = current_score()
  local target = blind_chips() or pending.data.blind_chips
  return {
    cards_played = pending.data.cards_played,
    played_cards = pending.data.played_cards,
    points_gained = after - before,
    score_before = before,
    score_after = after,
    blind_chips = target,
    blind_defeated = target ~= nil and after >= target or nil,
    hands_played_before = pending.data.hands_played_before,
    hands_played_after = current_hands_played(),
    final_phase = G and G.STATE or nil,
    timed_out = timed_out or nil,
  }
end

local function update_pending_responses()
  if #pending_responses == 0 then return end

  local remaining = {}
  local now = love.timer.getTime()
  local generation = bridge_generation
  for _, pending in ipairs(pending_responses) do
    local result
    local complete = false
    local timed_out = now - pending.started_at >= pending.timeout_seconds

    if pending.deferred == 'cash_out_ready' then
      local success, retry_result = pcall(actions.cash_out, {})
      if success and type(retry_result) == 'table' then
        result = retry_result
      else
        result = {
          ok = false,
          error_code = 'INTERNAL_ERROR',
          error_message = success and 'Cash-out action returned an invalid result' or tostring(retry_result),
        }
      end
      complete = not result.deferred
      if not complete and timed_out then
        result = {
          ok = false,
          error_code = 'CANNOT_USE_NOW',
          error_message = 'Cash-out button did not become ready',
        }
        complete = true
      end
    else
      local in_hand_played = G and G.STATES and G.STATE == G.STATES.HAND_PLAYED
      if in_hand_played then
        pending.saw_hand_played = true
      end

      complete = pending.saw_hand_played and G and G.STATES and G.STATE ~= G.STATES.HAND_PLAYED
      if complete or timed_out then
        result = {
          ok = true,
          data = finish_play_hand(pending, timed_out),
        }
        complete = true
      end
    end

    if complete then
      send_pending_result(pending, result)
    else
      remaining[#remaining + 1] = pending
    end
  end
  if generation == bridge_generation then pending_responses = remaining end
end

local function handle_request(method, params, request_id)
  local handler = actions[method]
  if not handler then
    return {
      ok = false,
      error_code = 'UNKNOWN_METHOD',
      error_message = 'Unknown method: ' .. tostring(method),
    }
  end

  local success, result = pcall(handler, params or {})
  if not success then
    return { ok = false, error_code = 'INTERNAL_ERROR', error_message = tostring(result) }
  end
  if type(result) ~= 'table' then
    return { ok = true, data = {} }
  end
  if result.ok ~= false and result.deferred then
    queue_deferred_response(result, request_id)
    return nil
  end
  return result
end

local function clear_pending_responses()
  bridge_generation = bridge_generation + 1
  pending_responses = {}
end

function Commands.init(modules)
  actions = modules.actions
  jsonrpc = modules.jsonrpc
  socket = modules.socket
  jsonrpc.configure({
    action = handle_request,
    state = modules.state.get_state_envelope,
    send = socket.send_response,
  })
  assert(
    socket.init(jsonrpc.dispatch, modules.socket_codec, clear_pending_responses),
    'MCP bridge transport failed to start'
  )
end

function Commands.update()
  socket.update()
  update_pending_responses()
end

function Commands.shutdown()
  socket.close()
end

return Commands
