local Commands = {}

local actions
local jsonrpc
local socket
local pending_responses = {}
local bridge_generation = 0

local DEFAULT_SETTLE_TIMEOUT = 10

-- An action whose effect resolves across game frames returns
-- `settle = { timeout_seconds, poll, on_timeout }`. The dispatcher holds the
-- response and calls `poll` every frame: it returns the final result table
-- once the effect is observable, or nil to keep waiting. `on_timeout` builds
-- the result sent when the deadline expires first.
local function run_settle_step(fn)
  local success, result = pcall(fn)
  if success then return result end
  return { ok = false, error_code = 'INTERNAL_ERROR', error_message = tostring(result) }
end

local function update_pending_responses()
  if #pending_responses == 0 then return end

  local remaining = {}
  local now = love.timer.getTime()
  local generation = bridge_generation
  for _, pending in ipairs(pending_responses) do
    local result = run_settle_step(pending.poll)
    if result == nil and now >= pending.deadline then
      result = run_settle_step(pending.on_timeout)
    end
    if result then
      jsonrpc.send_action_result(pending.request_id, result)
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
  if result.ok ~= false and type(result.settle) == 'table' then
    pending_responses[#pending_responses + 1] = {
      request_id = request_id,
      deadline = love.timer.getTime() + (result.settle.timeout_seconds or DEFAULT_SETTLE_TIMEOUT),
      poll = result.settle.poll,
      on_timeout = result.settle.on_timeout,
    }
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
