local Commands = {}

local actions
local game_events
local jsonrpc
local socket
-- Bridge lifecycle. Only a running bridge pumps the socket and accepts
-- requests; `init` may be retried after a failed start or a shutdown.
local BRIDGE_STATE = { IDLE = 'idle', RUNNING = 'running' }
local bridge_state = BRIDGE_STATE.IDLE

-- A deferred request waits until the game makes its effect observable.
-- `COMPLETED` and `CANCELLED` are terminal, and cancellation is mute: a
-- disconnect or shutdown must never emit a response for work already dropped.
local PENDING_STATE = { WAITING = 'waiting', COMPLETED = 'completed', CANCELLED = 'cancelled' }

local pending_responses = {}

-- Deferred actions return `settle = { on_game_update, timeout_seconds?, on_timeout? }`.
-- `on_game_update(work_mark)` runs once per game update and returns nil while
-- pending and a result once the game makes the effect observable; game
-- progression is the only completion signal. `work_mark` snapshots the event
-- queues from before the action ran (see game_events), so persistent or
-- unrelated queued events cannot stall completion.
-- `timeout_seconds` is a stall watchdog for effects the game may legitimately
-- never produce: `on_timeout` reports an error, never a synthesized result.
local function run_settle_step(fn, work_mark)
  local success, result = pcall(fn, work_mark)
  if success then return result end
  return { ok = false, error_code = 'INTERNAL_ERROR', error_message = tostring(result) }
end

-- The one terminal transition for a deferred request. Completion and
-- cancellation share it so a dropped request can never be sent later, and the
-- waiting check keeps a step that is already in flight from emitting twice.
local function resolve_pending(pending, new_state, result)
  if pending.state ~= PENDING_STATE.WAITING then return end
  pending.state = new_state
  for index = #pending_responses, 1, -1 do
    if pending_responses[index] == pending then table.remove(pending_responses, index) end
  end
  if pending.state == PENDING_STATE.COMPLETED then
    jsonrpc.send_action_result(pending.request_id, result, pending.send)
  end
end

local function update_pending_responses()
  if #pending_responses == 0 then return end

  -- Snapshot the waiters: a failed write closes its client mid-loop, which
  -- cancels that owner's other waiters and rewrites the live list.
  local waiting = {}
  for index = 1, #pending_responses do waiting[index] = pending_responses[index] end

  local now = love.timer.getTime()
  for _, pending in ipairs(waiting) do
    if pending.state == PENDING_STATE.WAITING then
      local result = run_settle_step(pending.on_game_update, pending.work_mark)
      if result == nil and pending.deadline and now >= pending.deadline then
        result = run_settle_step(pending.on_timeout)
      end
      if result then resolve_pending(pending, PENDING_STATE.COMPLETED, result) end
    end
  end
end

local function handle_request(method, params, request_id, send, owner)
  if bridge_state ~= BRIDGE_STATE.RUNNING then
    return { ok = false, error_code = 'INTERNAL_ERROR', error_message = 'Command bridge is not running' }
  end

  local handler = actions[method]
  if not handler then
    return {
      ok = false,
      error_code = 'UNKNOWN_METHOD',
      error_message = 'Unknown method: ' .. tostring(method),
    }
  end

  local work_mark = game_events.mark_work()
  local success, result = pcall(handler, params or {}, request_id, send, owner)
  if not success then
    return { ok = false, error_code = 'INTERNAL_ERROR', error_message = tostring(result) }
  end
  if type(result) ~= 'table' then
    return { ok = true, data = {} }
  end
  if result.ok ~= false and type(result.settle) == 'table' then
    pending_responses[#pending_responses + 1] = {
      state = PENDING_STATE.WAITING,
      request_id = request_id,
      work_mark = work_mark,
      deadline = result.settle.timeout_seconds
          and (love.timer.getTime() + result.settle.timeout_seconds)
        or nil,
      on_game_update = result.settle.on_game_update,
      on_timeout = result.settle.on_timeout,
      send = send or socket.send_response,
      owner = owner,
    }
    return nil
  end
  return result
end

-- Owner disconnect drops only that owner's deferred requests; a nil owner
-- (bridge shutdown) drops every waiter.
local function clear_pending_responses(owner)
  for index = #pending_responses, 1, -1 do
    local pending = pending_responses[index]
    if owner == nil or pending.owner == owner then
      resolve_pending(pending, PENDING_STATE.CANCELLED)
    end
  end
end


function Commands.init(modules)
  actions = modules.actions
  game_events = modules.game_events
  jsonrpc = modules.jsonrpc
  socket = modules.socket
  jsonrpc.configure({
    action = handle_request,
    state = modules.state.get_state_envelope,
    send = socket.send_response,
  })
  local started = socket.init(jsonrpc.dispatch, modules.socket_codec, clear_pending_responses, modules.instance)
  bridge_state = started and BRIDGE_STATE.RUNNING or BRIDGE_STATE.IDLE
  return started
end

function Commands.update()
  if bridge_state ~= BRIDGE_STATE.RUNNING then return end
  socket.update()
  update_pending_responses()
end

function Commands.shutdown()
  if bridge_state ~= BRIDGE_STATE.RUNNING then return end
  -- Mark the bridge stopped before the close: closing reports one disconnect
  -- per client, and those callbacks must not see a live bridge. The final
  -- sweep is what guarantees every waiter is dropped, connected or not.
  bridge_state = BRIDGE_STATE.IDLE
  socket.close()
  clear_pending_responses(nil)
end

return Commands
