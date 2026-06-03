--- jsonrpc.lua — JSON-RPC 2.0 request dispatcher for the Balatro MCP bridge.
-- Parses incoming request frames, routes methods to registered handlers, and
-- emits JSON-RPC response frames through the socket server send function.

local JsonRpc = {}

local ERROR_CODE_MAP = {
  WRONG_PHASE = -32010,
  INVALID_TARGET = -32011,
  INSUFFICIENT_FUNDS = -32012,
  SLOTS_FULL = -32013,
  ETERNAL_BLOCKED = -32014,
  PACK_LIMIT_REACHED = -32015,
  BOSS_REROLL_LOCKED = -32016,
  VOUCHER_DEPENDENCY = -32017,
  INTERNAL_ERROR = -32032,
}

local STANDARD_ERRORS = {
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
}

-- Set by commands.lua after migration (T6)
-- function(action_kind, params) -> { ok=bool, data=table, error_code=string, error_message=string }
JsonRpc.action_handler = nil

-- Set by state.lua after migration (T7)
-- function() -> { protocol_version=1, seq=N, payload=table }
JsonRpc.state_handler = nil

JsonRpc._send_fn = nil

local function log_debug(message)
  if sendDebugMessage then
    sendDebugMessage(message, "balatro_mcp")
  end
end

function JsonRpc.dispatch(client_socket, request_str)
  -- 1. Parse JSON
  local ok, req = pcall(JSON.decode, request_str)
  if not ok or type(req) ~= "table" then
    JsonRpc.send_error(client_socket, nil, STANDARD_ERRORS.PARSE_ERROR, "Parse error: " .. tostring(req))
    return
  end

  -- 2. Validate jsonrpc field
  if req.jsonrpc ~= "2.0" then
    JsonRpc.send_error(client_socket, req.id, STANDARD_ERRORS.INVALID_REQUEST, "Missing or invalid jsonrpc field")
    return
  end

  -- 3. Validate method
  if type(req.method) ~= "string" then
    JsonRpc.send_error(client_socket, req.id, STANDARD_ERRORS.INVALID_REQUEST, "Missing method field")
    return
  end

  -- 4. Validate id (must be present — no notifications per scope)
  if req.id == nil then
    log_debug("MCP: Ignoring notification (no id): " .. tostring(req.method))
    return
  end

  -- 5. Route method
  local method = req.method
  local params = req.params or {}

  if method == "get_state" then
    -- Pull-based state
    if not JsonRpc.state_handler then
      JsonRpc.send_error(client_socket, req.id, STANDARD_ERRORS.METHOD_NOT_FOUND, "State handler not registered")
      return
    end
    local state = JsonRpc.state_handler()
    JsonRpc.send_result(client_socket, req.id, state)
  elseif JsonRpc.action_handler then
    -- Game action
    local handler_ok, result = pcall(JsonRpc.action_handler, method, params)
    if not handler_ok then
      JsonRpc.send_error(
        client_socket,
        req.id,
        ERROR_CODE_MAP.INTERNAL_ERROR,
        "Action handler error: " .. tostring(result),
        { error_code = "INTERNAL_ERROR" }
      )
      return
    end

    if type(result) ~= "table" then
      result = { ok = true, data = {} }
    end

    if result.ok then
      JsonRpc.send_result(client_socket, req.id, { ok = true, data = result.data })
    else
      local code = ERROR_CODE_MAP[result.error_code] or STANDARD_ERRORS.METHOD_NOT_FOUND
      JsonRpc.send_error(
        client_socket,
        req.id,
        code,
        result.error_message or "Action failed",
        { error_code = result.error_code }
      )
    end
  else
    JsonRpc.send_error(client_socket, req.id, STANDARD_ERRORS.METHOD_NOT_FOUND, "Unknown method: " .. method)
  end
end

function JsonRpc.send_result(socket_fd, id, result)
  local response = {
    jsonrpc = "2.0",
    id = id,
    result = result,
  }
  local json_str = JSON.encode(response)
  -- Delegate to socket_server.send_response()
  if JsonRpc._send_fn then
    JsonRpc._send_fn(json_str)
  end
end

function JsonRpc.send_error(socket_fd, id, code, message, data)
  local response = {
    jsonrpc = "2.0",
    id = id,
    error = {
      code = code,
      message = message,
      data = data,
    },
  }
  local json_str = JSON.encode(response)
  if JsonRpc._send_fn then
    JsonRpc._send_fn(json_str)
  end
end

function JsonRpc.set_send_function(fn)
  JsonRpc._send_fn = fn
end

return JsonRpc
