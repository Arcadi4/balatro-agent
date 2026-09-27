local Commands = {}

local actions
local game_events
local jsonrpc
local socket
local pending_responses = {}
local bridge_active = false

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

local function update_pending_responses()
  if #pending_responses == 0 then return end

  local remaining = {}
  local now = love.timer.getTime()
  for _, pending in ipairs(pending_responses) do
    local result = run_settle_step(pending.on_game_update, pending.work_mark)
    if result == nil and pending.deadline and now >= pending.deadline then
      result = run_settle_step(pending.on_timeout)
    end
    if result then
      jsonrpc.send_action_result(pending.request_id, result, pending.send)
    else
      remaining[#remaining + 1] = pending
    end
  end
  pending_responses = remaining
end

local function handle_request(method, params, request_id, send, owner)
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

local function clear_pending_responses(owner)
  if owner == nil then
    pending_responses = {}
    return
  end

  local remaining = {}
  for _, pending in ipairs(pending_responses) do
    if pending.owner ~= owner then remaining[#remaining + 1] = pending end
  end
  pending_responses = remaining
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
  bridge_active = socket.init(jsonrpc.dispatch, modules.socket_codec, clear_pending_responses, modules.instance)
  return bridge_active
end

function Commands.update()
  if not bridge_active then return end
  socket.update()
  update_pending_responses()
end

function Commands.shutdown()
  if not bridge_active then return end
  socket.close()
  bridge_active = false
end

return Commands
