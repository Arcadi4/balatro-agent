local Commands = {}

local actions
local jsonrpc
local socket
local pending_responses = {}
local bridge_active = false

local DEFAULT_SETTLE_TIMEOUT = 10

-- Deferred actions return `settle = { timeout_seconds, poll, on_timeout }`.
-- `poll` returns nil while pending and a result once the effect is observable;
-- `on_timeout` supplies the terminal result when the deadline expires.
local function run_settle_step(fn)
  local success, result = pcall(fn)
  if success then return result end
  return { ok = false, error_code = 'INTERNAL_ERROR', error_message = tostring(result) }
end

local function update_pending_responses()
  if #pending_responses == 0 then return end

  local remaining = {}
  local now = love.timer.getTime()
  for _, pending in ipairs(pending_responses) do
    local result = run_settle_step(pending.poll)
    if result == nil and now >= pending.deadline then
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
      deadline = love.timer.getTime() + (result.settle.timeout_seconds or DEFAULT_SETTLE_TIMEOUT),
      poll = result.settle.poll,
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
