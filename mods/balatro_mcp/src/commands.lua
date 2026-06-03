--- commands.lua — Socket-based command dispatcher for the Balatro MCP bridge.
-- Routes JSON-RPC methods to registered Balatro action handlers and keeps
-- lightweight in-memory phase/deferred-response state for debugging.

local Commands = {}

local current_mod = SMODS and SMODS.current_mod
local MOD_PATH = current_mod and current_mod.path
local MOD_ID = current_mod and current_mod.id or "balatro_mcp"

--- Constants
local PROTOCOL_VERSION = 1
local MOD_VERSION = "0.1.0"

--- State
local frame_count = 0
local initialized = false
local state_seq = 0
local state_writer = nil -- retained for compatibility with existing main.lua wiring
local current_phase = "unknown"

--- Action dispatcher registry (populated by actions module)
Commands._actions = {}
local action_dispatchers = Commands._actions

--- State module hook for JSON-RPC get_state
Commands._state_module = nil

--- Deferred response tracking (T8 adapts completion delivery to JSON-RPC ids)
Commands._pending_responses = {}
Commands._completed_deferred_responses = {}
local pending_responses = Commands._pending_responses

--- Socket/JSON-RPC modules loaded lazily from the current mod directory.
Commands._jsonrpc = nil
Commands._socket_server = nil

local function S(name)
  return G and G.STATES and G.STATES[name]
end

local function log_debug(message)
  if sendDebugMessage then
    pcall(sendDebugMessage, tostring(message), "balatro_mcp")
  end
end

local function load_mod_module(filename)
  if not MOD_PATH or not NFS or not NFS.read then
    return nil, "SMODS.current_mod.path or NFS.read unavailable"
  end

  local source, read_err = NFS.read(MOD_PATH .. "src/" .. filename .. ".lua")
  if not source then
    return nil, read_err or ("Unable to load src/" .. filename .. ".lua")
  end

  local chunk, load_err = load(source, ('=[SMODS %s "src/%s.lua"]'):format(MOD_ID, filename))
  if not chunk then
    return nil, load_err
  end

  local ok, module_or_err = pcall(chunk)
  if not ok then
    return nil, module_or_err
  end

  return module_or_err
end

local function ensure_state_module()
  if Commands._state_module then
    return Commands._state_module
  end

  local state_module, err = load_mod_module("state")
  if not state_module then
    log_debug("MCP: Failed to load state module for get_state: " .. tostring(err))
    return nil
  end

  Commands._state_module = state_module
  return state_module
end

local function ensure_socket_modules()
  if Commands._jsonrpc and Commands._socket_server then
    return true
  end

  local jsonrpc, jsonrpc_err = load_mod_module("jsonrpc")
  if not jsonrpc then
    log_debug("MCP: Failed to load jsonrpc.lua: " .. tostring(jsonrpc_err))
    return false
  end

  local socket_server, socket_err = load_mod_module("socket_server")
  if not socket_server then
    log_debug("MCP: Failed to load socket_server.lua: " .. tostring(socket_err))
    return false
  end

  jsonrpc.action_handler = Commands.handle_request
  jsonrpc.state_handler = Commands.get_state_handler
  jsonrpc.set_send_function(socket_server.send_response)
  socket_server.on_request_callback = function(request)
    jsonrpc.dispatch(nil, request)
  end

  Commands._jsonrpc = jsonrpc
  Commands._socket_server = socket_server
  return true
end

local function ensure_socket_server_started()
  if initialized then
    return true
  end

  if not ensure_socket_modules() then
    return false
  end

  local ok, started = pcall(Commands._socket_server.init)
  if not ok then
    log_debug("MCP: Socket server init failed: " .. tostring(started))
    return false
  end

  initialized = started ~= false
  if initialized then
    log_debug("MCP: Socket command dispatcher initialized (protocol v" .. tostring(PROTOCOL_VERSION) .. ")")
  end
  return initialized
end

local function detect_phase()
  if G and G.STATE and G.STATES then
    local state_val = G.STATE
    if state_val == G.STATES.SELECTING_HAND or state_val == G.STATES.HAND_PLAYED or state_val == G.STATES.DRAW_TO_HAND then
      return "play"
    elseif state_val == G.STATES.SHOP or state_val == G.STATES.TAROT_PACK or state_val == G.STATES.PLANET_PACK
        or state_val == G.STATES.SPECTRAL_PACK or state_val == G.STATES.STANDARD_PACK or state_val == G.STATES.BUFFOON_PACK then
      return "shop"
    elseif state_val == G.STATES.BLIND_SELECT then
      return "blind_select"
    elseif state_val == G.STATES.ROUND_EVAL or state_val == G.STATES.GAME_OVER then
      return "scoring"
    elseif state_val == G.STATES.MENU or state_val == G.STATES.SPLASH then
      return "menu"
    else
      return "transition"
    end
  end

  return "unknown"
end

local function queue_deferred_response(kind, result, request_id, client_fd)
  pending_responses[#pending_responses + 1] = {
    kind = kind,
    deferred = result.deferred,
    data = result.data or {},
    started_at = love.timer.getTime(),
    timeout_seconds = result.timeout_seconds or 10,
    saw_hand_played = false,
    request_id = request_id,
    client_fd = client_fd,
  }
end

local function current_score()
  return G and G.GAME and G.GAME.chips or 0
end

local function current_hands_played()
  return G and G.GAME and G.GAME.current_round and G.GAME.current_round.hands_played or 0
end

local function blind_chips()
  return G and G.GAME and G.GAME.blind and G.GAME.blind.chips or nil
end

local function record_deferred_response(pending, ok_flag, error_code, error_message, data)
  Commands._completed_deferred_responses[#Commands._completed_deferred_responses + 1] = {
    kind = pending.kind,
    deferred = pending.deferred,
    ok = ok_flag,
    error_code = error_code,
    error_message = error_message,
    data = data,
    completed_at = love.timer.getTime(),
  }
end

local function finish_play_hand_response(pending, timed_out)
  local before = pending.data.score_before or 0
  local after = current_score()
  local gained = after - before
  local target = blind_chips() or pending.data.blind_chips
  local data = {
    cards_played = pending.data.cards_played,
    points_gained = gained,
    score_before = before,
    score_after = after,
    blind_chips = target,
    blind_defeated = target ~= nil and after >= target or nil,
    hands_played_before = pending.data.hands_played_before,
    hands_played_after = current_hands_played(),
    final_phase = G and G.STATE or nil,
    timed_out = timed_out or nil,
  }

  record_deferred_response(pending, true, nil, nil, data)
end

function Commands.update_pending_responses()
  if #pending_responses == 0 then return end

  local remaining = {}
  local now = love.timer.getTime()
  for _, pending in ipairs(pending_responses) do
    local finished = false

    if pending.deferred == "play_hand_score" then
      if G and G.STATE == S("HAND_PLAYED") then
        pending.saw_hand_played = true
      end

      local timed_out = (now - pending.started_at) >= pending.timeout_seconds
      local scoring_finished = pending.saw_hand_played and G and G.STATE ~= S("HAND_PLAYED")
      if scoring_finished or timed_out then
        finish_play_hand_response(pending, timed_out)
        if pending.request_id and Commands._jsonrpc then
          if timed_out then
            Commands._jsonrpc.send_error(pending.client_fd, pending.request_id, -32004, "Scoring timeout", {timed_out=true})
          else
            local completed = Commands._completed_deferred_responses[#Commands._completed_deferred_responses]
            if completed then
              Commands._jsonrpc.send_result(pending.client_fd, pending.request_id, {ok=true, data=completed.data})
            end
          end
        end
        finished = true
      end
    else
      local error_message = "Unknown deferred response kind: " .. tostring(pending.deferred)
      record_deferred_response(
        pending,
        false,
        "INTERNAL_ERROR",
        error_message,
        nil
      )
      if pending.request_id and Commands._jsonrpc then
        Commands._jsonrpc.send_error(
          pending.client_fd,
          pending.request_id,
          -32032,
          error_message,
          { error_code = "INTERNAL_ERROR" }
        )
      end
      finished = true
    end

    if not finished then
      remaining[#remaining + 1] = pending
    end
  end

  Commands._pending_responses = remaining
  pending_responses = Commands._pending_responses
end

function Commands.handle_request(method, params, request_id, client_fd)
  local handler = action_dispatchers[method]
  if not handler then
    return { ok = false, error_code = "UNKNOWN_METHOD", error_message = "Unknown method: " .. tostring(method) }
  end

  local ok, result = pcall(handler, params or {})
  if not ok then
    return { ok = false, error_code = "INTERNAL_ERROR", error_message = tostring(result) }
  end

  if type(result) ~= "table" then
    result = { ok = true, data = {} }
  end

  if result.ok ~= false and result.deferred then
    queue_deferred_response(method, result, request_id, client_fd)
    return nil
  end

  return result
end

function Commands.get_state_handler(params)
  local state_module = ensure_state_module()
  if state_module and state_module.get_state_envelope then
    local envelope = state_module.get_state_envelope(params)
    if envelope and type(envelope.seq) == "number" then
      state_seq = envelope.seq
    end
    return envelope
  end

  return nil
end

function Commands.register_action(kind, handler)
  action_dispatchers[kind] = handler
end

function Commands.set_state_module(state_module)
  Commands._state_module = state_module
end

function Commands.set_state_seq(seq)
  state_seq = seq
end

function Commands.set_state_writer(writer)
  state_writer = writer
end

function Commands.get_state_writer()
  return state_writer
end

function Commands.get_protocol_version()
  return PROTOCOL_VERSION
end

function Commands.get_phase()
  current_phase = detect_phase()
  return current_phase
end

function Commands.update(dt)
  frame_count = frame_count + 1

  if ensure_socket_server_started() and Commands._socket_server and Commands._socket_server.update then
    local ok, err = pcall(Commands._socket_server.update, dt)
    if not ok and frame_count % 60 == 0 then
      log_debug("MCP: Socket server update failed: " .. tostring(err))
    end
  end

  local ok_pending, pending_err = pcall(Commands.update_pending_responses)
  if not ok_pending then
    log_debug("MCP: Deferred response update failed: " .. tostring(pending_err))
  end
end

function Commands.shutdown()
  if Commands._socket_server and Commands._socket_server.close then
    local ok, err = pcall(Commands._socket_server.close)
    if not ok then
      log_debug("MCP: Socket server shutdown failed: " .. tostring(err))
    end
  end

  initialized = false
  log_debug("MCP: Socket command dispatcher shut down")
end

return Commands
