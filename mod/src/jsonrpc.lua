local JsonRpc = {}

local ERROR_CODES = {
  WRONG_PHASE = -32010,
  INVALID_TARGET = -32011,
  INSUFFICIENT_FUNDS = -32012,
  SLOTS_FULL = -32013,
  CANNOT_SELL = -32014,
  PACK_LIMIT_REACHED = -32015,
  VOUCHER_DEPENDENCY = -32017,
  CANNOT_USE_NOW = -32018,
  LOCKED = -32019,
  PROTOCOL_MISMATCH = -32003,
  INTERNAL_ERROR = -32032,
  GAME_NOT_RUNNING = -32001,
  UNKNOWN_METHOD = -32601,
}

local action_handler
local state_handler
local send

local function response_sender(sender)
  return sender or send
end

function JsonRpc.send_result(id, result, sender)
  response_sender(sender)({ jsonrpc = '2.0', id = id, result = result })
end

function JsonRpc.send_error(id, code, message, data, sender)
  response_sender(sender)({
    jsonrpc = '2.0',
    id = id,
    error = { code = code, message = message, data = data },
  })
end

function JsonRpc.dispatch(request, sender, owner)
  if type(request) ~= 'table' or request.jsonrpc ~= '2.0' then
    local request_id = type(request) == 'table' and request.id or nil
    JsonRpc.send_error(request_id, -32600, 'Invalid JSON-RPC request', nil, sender)
    return
  end
  if type(request.method) ~= 'string' then
    JsonRpc.send_error(request.id, -32600, 'Missing method', nil, sender)
    return
  end
  if request.id == nil then return end
  if request.params ~= nil and type(request.params) ~= 'table' then
    JsonRpc.send_error(request.id, -32602, 'params must be an object', nil, sender)
    return
  end

  if request.method == 'get_state' then
    local state_ok, state = pcall(state_handler)
    if state_ok and state then
      JsonRpc.send_result(request.id, state, sender)
    else
      JsonRpc.send_error(
        request.id,
        -32005,
        'Game state is unavailable',
        { error_code = 'STATE_NOT_FOUND' },
        sender
      )
    end
    return
  end

  local result = action_handler(request.method, request.params or {}, request.id, sender, owner)
  if result == nil then return end
  JsonRpc.send_action_result(request.id, result, sender)
end

function JsonRpc.send_action_result(id, result, sender)
  if result.ok then
    JsonRpc.send_result(id, { ok = true, data = result.data or {} }, sender)
    return
  end

  JsonRpc.send_error(
    id,
    ERROR_CODES[result.error_code] or ERROR_CODES.INTERNAL_ERROR,
    result.error_message or 'Action failed',
    { error_code = result.error_code or 'INTERNAL_ERROR' },
    sender
  )
end

function JsonRpc.configure(options)
  action_handler = options.action
  state_handler = options.state
  send = options.send
end

return JsonRpc
