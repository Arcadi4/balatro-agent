--- commands.lua — Command consumer for the Balatro MCP bridge.
-- Polls bridge/commands/ each frame, validates, dispatches, and writes responses.

local Commands = {}

--- Constants
local PROTOCOL_VERSION = 1
local DEFAULT_TTL = 5 -- seconds
local MOD_VERSION = "0.1.0"

--- Bridge directory paths (relative to love.filesystem save dir)
local BRIDGE_REL = "Mods/balatro_mcp/bridge/"
local COMMANDS_REL = BRIDGE_REL .. "commands/"
local RESPONSES_REL = BRIDGE_REL .. "responses/"
local HEARTBEAT_REL = BRIDGE_REL .. "heartbeat.json"
local INSTANCE_LOCK_REL = BRIDGE_REL .. "instance.lock"
local PROTOCOL_VERSION_REL = BRIDGE_REL .. "protocol_version.txt"

--- Absolute bridge directory (resolved lazily)
local bridge_abs = nil
local commands_abs = nil
local responses_abs = nil

--- State
local state_seq = 0
local frame_count = 0
local time_offset = nil -- calibration: os.time() - love.timer.getTime() at init
local initialized = false
local pending_responses = {}
local state_writer = nil

--- Action dispatcher registry (populated by actions module)
local action_dispatchers = {}

local function S(name)
  return G and G.STATES and G.STATES[name]
end

---------------------------------------------------------------------------
-- Utility: get absolute bridge path
---------------------------------------------------------------------------
local function get_bridge_abs()
  if not bridge_abs then
    bridge_abs = love.filesystem.getSaveDirectory() .. "/Mods/balatro_mcp/bridge/"
    commands_abs = bridge_abs .. "commands/"
    responses_abs = bridge_abs .. "responses/"
  end
  return bridge_abs
end

---------------------------------------------------------------------------
-- Utility: atomic write (write to .tmp then os.rename)
---------------------------------------------------------------------------
local function atomic_write(abs_path, content)
  local tmp_path = abs_path .. ".tmp"
  local f, err = io.open(tmp_path, "w")
  if not f then
    return false, "Failed to open tmp file: " .. tostring(err)
  end
  f:write(content)
  f:close()
  local ok, rename_err = os.rename(tmp_path, abs_path)
  if not ok then
    return false, "Failed to rename: " .. tostring(rename_err)
  end
  return true
end

---------------------------------------------------------------------------
-- Utility: read file contents
---------------------------------------------------------------------------
local function read_file(abs_path)
  local f, err = io.open(abs_path, "r")
  if not f then
    return nil, err
  end
  local content = f:read("*a")
  f:close()
  return content
end

---------------------------------------------------------------------------
-- Utility: delete file
---------------------------------------------------------------------------
local function delete_file(abs_path)
  os.remove(abs_path)
end

---------------------------------------------------------------------------
-- Utility: move file
---------------------------------------------------------------------------
local function move_file(src, dest)
  os.rename(src, dest)
end

---------------------------------------------------------------------------
-- Utility: ensure directory exists (using os-level mkdir)
---------------------------------------------------------------------------
local function ensure_dir(abs_path)
  -- Use love.filesystem for relative paths where possible,
  -- fall back to os.execute for absolute paths
  os.execute('mkdir -p "' .. abs_path .. '"')
end

---------------------------------------------------------------------------
-- Utility: list files in directory sorted by name
---------------------------------------------------------------------------
local function list_command_files()
  local files = {}
  local items = love.filesystem.getDirectoryItems(COMMANDS_REL) or {}
  for _, name in ipairs(items) do
    -- Only include .json files, skip .tmp and subdirectories
    if name:match("^%d+%.json$") then
      files[#files + 1] = name
    end
  end
  table.sort(files)
  return files
end

---------------------------------------------------------------------------
-- Utility: minimal JSON encoder (for response/heartbeat/lock)
---------------------------------------------------------------------------
local function json_encode(tbl)
  -- Use the game's built-in JSON if available, otherwise minimal impl
  if _G.json and _G.json.encode then
    return _G.json.encode(tbl)
  end
  -- Fallback: use SMODS/Lovely's JSON library
  if _G.JSON and _G.JSON.encode then
    return _G.JSON.encode(tbl)
  end
  if SMODS and SMODS.JSON and SMODS.JSON.encode then
    return SMODS.JSON.encode(tbl)
  end
  -- Last resort: simple encoder for flat tables
  return Commands._simple_json_encode(tbl)
end

--- Simple JSON encoder for flat/shallow tables
function Commands._simple_json_encode(val)
  local t = type(val)
  if t == "nil" then
    return "null"
  elseif t == "boolean" then
    return val and "true" or "false"
  elseif t == "number" then
    if val ~= val then return "null" end -- NaN
    if val == math.huge or val == -math.huge then return "null" end
    return tostring(val)
  elseif t == "string" then
    -- Escape special characters
    local escaped = val:gsub('\\', '\\\\'):gsub('"', '\\"')
      :gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t')
    return '"' .. escaped .. '"'
  elseif t == "table" then
    -- Check if array
    local is_array = (#val > 0) or next(val) == nil
    if is_array and #val > 0 then
      -- Verify it's actually a sequence
      for i = 1, #val do
        if val[i] == nil then
          is_array = false
          break
        end
      end
    end
    if is_array then
      local parts = {}
      for i = 1, #val do
        parts[i] = Commands._simple_json_encode(val[i])
      end
      return "[" .. table.concat(parts, ",") .. "]"
    else
      local parts = {}
      for k, v in pairs(val) do
        if type(k) == "string" then
          parts[#parts + 1] = Commands._simple_json_encode(k) .. ":" .. Commands._simple_json_encode(v)
        end
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
  end
  return "null"
end

---------------------------------------------------------------------------
-- Utility: minimal JSON decoder
---------------------------------------------------------------------------
local function json_decode(str)
  -- Use the game's built-in JSON if available
  if _G.json and _G.json.decode then
    return _G.json.decode(str)
  end
  if _G.JSON and _G.JSON.decode then
    return _G.JSON.decode(str)
  end
  if SMODS and SMODS.JSON and SMODS.JSON.decode then
    return SMODS.JSON.decode(str)
  end
  return nil, "No JSON decoder available"
end

---------------------------------------------------------------------------
-- Write response atomically
---------------------------------------------------------------------------
local function write_response(seq, ok_flag, error_code, error_message, data, applied_seq)
  get_bridge_abs()
  if state_writer then
    local writer_ok, next_seq = pcall(state_writer)
    if writer_ok and type(next_seq) == "number" then
      state_seq = next_seq
    elseif not writer_ok then
      sendDebugMessage("MCP: Forced state write failed before response " .. tostring(seq) .. ": " .. tostring(next_seq), "balatro_mcp")
    end
  end
  local response = {
    seq = seq,
    ok = ok_flag,
    error_code = error_code,
    error_message = error_message,
    data = data,
    applied_state_seq = state_seq,
  }
  local content = json_encode(response)
  local seq_str = string.format("%06d", seq)
  local path = responses_abs .. seq_str .. ".json"
  local success, err = atomic_write(path, content)
  if not success then
    sendDebugMessage("MCP: Failed to write response " .. seq_str .. ": " .. tostring(err), "balatro_mcp")
  end
  return success
end

local function queue_deferred_response(seq, kind, result)
  pending_responses[#pending_responses + 1] = {
    seq = seq,
    kind = kind,
    deferred = result.deferred,
    data = result.data or {},
    started_at = love.timer.getTime(),
    timeout_seconds = result.timeout_seconds or 10,
    saw_hand_played = false,
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
  write_response(pending.seq, true, nil, nil, data)
end

local function update_pending_responses()
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
        finished = true
      end
    else
      write_response(pending.seq, false, "INTERNAL_ERROR", "Unknown deferred response kind: " .. tostring(pending.deferred), nil, state_seq)
      finished = true
    end

    if not finished then
      remaining[#remaining + 1] = pending
    end
  end

  pending_responses = remaining
end

---------------------------------------------------------------------------
-- Process a single command
---------------------------------------------------------------------------
local function process_command(filename)
  get_bridge_abs()
  local filepath = commands_abs .. filename
  local seq_str = filename:match("^(%d+)%.json$")
  if not seq_str then
    return
  end
  local seq = tonumber(seq_str)

  -- Check if response already exists (idempotent — skip reprocessing)
  local existing_resp = responses_abs .. seq_str .. ".json"
  local check_f = io.open(existing_resp, "r")
  if check_f then
    check_f:close()
    -- Response exists, delete command and skip
    delete_file(filepath)
    return
  end

  -- Read command file
  local content, read_err = read_file(filepath)
  if not content then
    sendDebugMessage("MCP: Failed to read command " .. filename .. ": " .. tostring(read_err), "balatro_mcp")
    move_file(filepath, commands_abs .. "failed/" .. filename)
    return
  end

  -- Parse JSON
  local ok_parse, command = pcall(json_decode, content)
  if not ok_parse or not command then
    sendDebugMessage("MCP: Invalid JSON in command " .. filename, "balatro_mcp")
    write_response(seq, false, "INTERNAL_ERROR", "Invalid JSON in command file", nil, state_seq)
    move_file(filepath, commands_abs .. "invalid/" .. filename)
    return
  end

  -- Handle json_decode returning (nil, err) pattern
  if command == nil then
    sendDebugMessage("MCP: JSON decode returned nil for " .. filename, "balatro_mcp")
    write_response(seq, false, "INTERNAL_ERROR", "JSON decode failed", nil, state_seq)
    move_file(filepath, commands_abs .. "invalid/" .. filename)
    return
  end

  -- Validate protocol version
  if command.protocol_version ~= PROTOCOL_VERSION then
    sendDebugMessage("MCP: Protocol mismatch in command " .. filename ..
      " (got " .. tostring(command.protocol_version) .. ", expected " .. tostring(PROTOCOL_VERSION) .. ")", "balatro_mcp")
    write_response(seq, false, "PROTOCOL_MISMATCH",
      "Expected protocol_version " .. tostring(PROTOCOL_VERSION) .. ", got " .. tostring(command.protocol_version),
      nil, state_seq)
    delete_file(filepath)
    return
  end

  -- Check TTL (command staleness)
  local current_time = love.timer.getTime()
  local wrote_at = command.wrote_at
  if wrote_at and time_offset then
    -- Convert wrote_at (unix epoch seconds) to love.timer time base
    local command_age = current_time - (wrote_at - time_offset)
    if command_age > DEFAULT_TTL then
      sendDebugMessage("MCP: Stale command " .. filename .. " (age=" .. string.format("%.1f", command_age) .. "s)", "balatro_mcp")
      write_response(seq, false, "STATE_STALE",
        "Command expired (age " .. string.format("%.1f", command_age) .. "s > TTL " .. tostring(DEFAULT_TTL) .. "s)",
        nil, state_seq)
      move_file(filepath, commands_abs .. "failed/" .. filename)
      return
    end
  end

  -- Dispatch by kind
  local kind = command.kind
  if not kind then
    sendDebugMessage("MCP: Command " .. filename .. " missing 'kind' field", "balatro_mcp")
    write_response(seq, false, "INTERNAL_ERROR", "Command missing 'kind' field", nil, state_seq)
    move_file(filepath, commands_abs .. "failed/" .. filename)
    return
  end

  local dispatcher = action_dispatchers[kind]
  if not dispatcher then
    sendDebugMessage("MCP: Unknown command kind '" .. tostring(kind) .. "' in " .. filename, "balatro_mcp")
    write_response(seq, false, "INTERNAL_ERROR", "Unknown command kind: " .. tostring(kind), nil, state_seq)
    move_file(filepath, commands_abs .. "failed/" .. filename)
    return
  end

  -- Execute dispatcher (wrapped in pcall for safety)
  local dispatch_ok, result = pcall(dispatcher, command.args or {}, seq)
  if not dispatch_ok then
    sendDebugMessage("MCP: Dispatch error for " .. kind .. ": " .. tostring(result), "balatro_mcp")
    write_response(seq, false, "INTERNAL_ERROR", "Dispatch error: " .. tostring(result), nil, state_seq)
    move_file(filepath, commands_abs .. "failed/" .. filename)
    return
  end

  -- result should be a table: { ok, error_code?, error_message?, data? }
  if type(result) ~= "table" then
    result = { ok = true }
  end

  if result.ok ~= false and result.deferred then
    queue_deferred_response(seq, kind, result)
    delete_file(filepath)
    return
  end

  write_response(seq, result.ok ~= false, result.error_code, result.error_message, result.data)

  -- On success, delete command file; on failure, move to failed/
  if result.ok ~= false then
    delete_file(filepath)
  else
    move_file(filepath, commands_abs .. "failed/" .. filename)
  end
end

---------------------------------------------------------------------------
-- Update heartbeat
---------------------------------------------------------------------------
local function update_heartbeat()
  get_bridge_abs()
  local current_time = love.timer.getTime()
  local phase = "unknown"

  -- Determine current phase from G.STATE if available
  if G and G.STATE then
    local state_val = G.STATE
    if state_val == G.STATES.SELECTING_HAND or state_val == G.STATES.HAND_PLAYED or state_val == G.STATES.DRAW_TO_HAND then
      phase = "play"
    elseif state_val == G.STATES.SHOP or state_val == G.STATES.TAROT_PACK or state_val == G.STATES.PLANET_PACK
        or state_val == G.STATES.SPECTRAL_PACK or state_val == G.STATES.STANDARD_PACK or state_val == G.STATES.BUFFOON_PACK then
      phase = "shop"
    elseif state_val == G.STATES.BLIND_SELECT then
      phase = "blind_select"
    elseif state_val == G.STATES.ROUND_EVAL or state_val == G.STATES.GAME_OVER then
      phase = "scoring"
    elseif state_val == G.STATES.MENU or state_val == G.STATES.SPLASH then
      phase = "menu"
    else
      phase = "transition"
    end
  end

  local heartbeat = {
    protocol_version = PROTOCOL_VERSION,
    seq = state_seq,
    phase = phase,
    wrote_at = current_time,
    mod_version = MOD_VERSION,
  }

  local content = json_encode(heartbeat)
  local path = bridge_abs .. "heartbeat.json"
  atomic_write(path, content)
end

---------------------------------------------------------------------------
-- Write instance lock
---------------------------------------------------------------------------
local function write_instance_lock()
  get_bridge_abs()
  local lock = {
    pid = tonumber(tostring(os.getenv("PID") or "0")) or 0,
    start_time = os.time(),
    protocol_version = PROTOCOL_VERSION,
    mod_version = MOD_VERSION,
  }
  local content = json_encode(lock)
  local path = bridge_abs .. "instance.lock"
  atomic_write(path, content)
end

---------------------------------------------------------------------------
-- Write protocol version file
---------------------------------------------------------------------------
local function write_protocol_version()
  get_bridge_abs()
  local path = bridge_abs .. "protocol_version.txt"
  local f = io.open(path, "w")
  if f then
    f:write(tostring(PROTOCOL_VERSION))
    f:close()
  end
end

---------------------------------------------------------------------------
-- Initialize bridge directories and files
---------------------------------------------------------------------------
function Commands.init()
  if initialized then return end

  get_bridge_abs()

  -- Ensure all required directories exist through LÖVE first, then absolute fallback.
  love.filesystem.createDirectory(BRIDGE_REL)
  love.filesystem.createDirectory(COMMANDS_REL)
  love.filesystem.createDirectory(COMMANDS_REL .. "invalid/")
  love.filesystem.createDirectory(COMMANDS_REL .. "failed/")
  love.filesystem.createDirectory(RESPONSES_REL)
  ensure_dir(bridge_abs)
  ensure_dir(commands_abs)
  ensure_dir(commands_abs .. "invalid/")
  ensure_dir(commands_abs .. "failed/")
  ensure_dir(responses_abs)

  -- Calibrate time offset: difference between os.time (unix epoch) and love.timer.getTime()
  time_offset = os.time() - love.timer.getTime()

  -- Write handshake files
  local ok_pv, err_pv = pcall(write_protocol_version)
  if not ok_pv then
    sendDebugMessage("MCP: Failed to write protocol_version.txt: " .. tostring(err_pv), "balatro_mcp")
  end

  local ok_lock, err_lock = pcall(write_instance_lock)
  if not ok_lock then
    sendDebugMessage("MCP: Failed to write instance.lock: " .. tostring(err_lock), "balatro_mcp")
  end

  initialized = true
  sendDebugMessage("MCP: Command consumer initialized (protocol v" .. tostring(PROTOCOL_VERSION) .. ")", "balatro_mcp")
end

---------------------------------------------------------------------------
-- Main update function — called every frame from love.update
---------------------------------------------------------------------------
function Commands.update(dt)
  if not initialized then
    Commands.init()
  end

  frame_count = frame_count + 1

  -- Update heartbeat every frame
  local ok_hb, err_hb = pcall(update_heartbeat)
  if not ok_hb then
    -- Heartbeat failure is non-fatal; log but continue
    if frame_count % 60 == 0 then
      sendDebugMessage("MCP: Heartbeat write failed: " .. tostring(err_hb), "balatro_mcp")
    end
  end

  -- Poll commands directory
  local ok_poll, files_or_err = pcall(list_command_files)
  if not ok_poll then
    -- Directory listing failure is non-fatal
    if frame_count % 60 == 0 then
      sendDebugMessage("MCP: Failed to list commands: " .. tostring(files_or_err), "balatro_mcp")
    end
    return
  end

  local files = files_or_err
  if not files or #files == 0 then
    local ok_pending, pending_err = pcall(update_pending_responses)
    if not ok_pending then
      sendDebugMessage("MCP: Deferred response update failed: " .. tostring(pending_err), "balatro_mcp")
    end
    return
  end

  -- Process each command in sorted order
  for _, filename in ipairs(files) do
    local ok_proc, proc_err = pcall(process_command, filename)
    if not ok_proc then
      sendDebugMessage("MCP: Error processing command " .. filename .. ": " .. tostring(proc_err), "balatro_mcp")
    end
  end

  local ok_pending, pending_err = pcall(update_pending_responses)
  if not ok_pending then
    sendDebugMessage("MCP: Deferred response update failed: " .. tostring(pending_err), "balatro_mcp")
  end
end

---------------------------------------------------------------------------
-- Shutdown — clean up lock and heartbeat (best-effort)
---------------------------------------------------------------------------
function Commands.shutdown()
  if not initialized then return end

  get_bridge_abs()
  pcall(delete_file, bridge_abs .. "instance.lock")
  pcall(delete_file, bridge_abs .. "heartbeat.json")

  sendDebugMessage("MCP: Command consumer shut down", "balatro_mcp")
end

---------------------------------------------------------------------------
-- Register an action dispatcher
---------------------------------------------------------------------------
function Commands.register_action(kind, handler)
  action_dispatchers[kind] = handler
end

---------------------------------------------------------------------------
-- Set current state seq (called by state writer)
---------------------------------------------------------------------------
function Commands.set_state_seq(seq)
  state_seq = seq
end

function Commands.set_state_writer(writer)
  state_writer = writer
end

---------------------------------------------------------------------------
-- Get protocol version (for other modules)
---------------------------------------------------------------------------
function Commands.get_protocol_version()
  return PROTOCOL_VERSION
end

return Commands
