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
    started_at = love.timer.getTime(),
    timeout_seconds = result.timeout_seconds or 10,
    request_id = request_id,
    saw_hand_played = false,
  }
end

local function finish_play_hand(pending, timed_out)
  local before = pending.data.score_before or 0
  local after = current_score()
  local target = blind_chips() or pending.data.blind_chips
  return {
    cards_played = pending.data.cards_played,
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
    if G and G.STATE == G.STATES.HAND_PLAYED then
      pending.saw_hand_played = true
    end

    local timed_out = now - pending.started_at >= pending.timeout_seconds
    local finished = pending.saw_hand_played and G and G.STATE ~= G.STATES.HAND_PLAYED
    if finished or timed_out then
      jsonrpc.send_result(pending.request_id, {
        ok = true,
        data = finish_play_hand(pending, timed_out),
      })
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
