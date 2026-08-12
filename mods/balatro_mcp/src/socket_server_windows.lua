local ffi = require('ffi')
local kernel32 = ffi.load('kernel32')

ffi.cdef([[
  typedef void *HANDLE;
  typedef int BOOL;
  typedef unsigned long DWORD;
  HANDLE CreateNamedPipeA(
    const char *name,
    DWORD open_mode,
    DWORD pipe_mode,
    DWORD max_instances,
    DWORD out_buffer_size,
    DWORD in_buffer_size,
    DWORD default_timeout,
    void *security_attributes
  );
  BOOL ConnectNamedPipe(HANDLE pipe, void *overlapped);
  BOOL DisconnectNamedPipe(HANDLE pipe);
  BOOL ReadFile(HANDLE file, void *buffer, DWORD bytes_to_read, DWORD *bytes_read, void *overlapped);
  BOOL WriteFile(HANDLE file, const void *buffer, DWORD bytes_to_write, DWORD *bytes_written, void *overlapped);
  BOOL CloseHandle(HANDLE object);
  DWORD GetLastError(void);
]])

local SocketServer = {}

local PIPE_NAME = os.getenv('BALATRO_BRIDGE_SOCKET') or '\\\\.\\pipe\\balatro-mcp'
local PIPE_ACCESS_DUPLEX = 0x00000003
local PIPE_NOWAIT = 0x00000001
local PIPE_REJECT_REMOTE_CLIENTS = 0x00000008
local ERROR_BROKEN_PIPE = 109
local ERROR_NO_DATA = 232
local ERROR_PIPE_NOT_CONNECTED = 233
local ERROR_PIPE_CONNECTED = 535
local ERROR_PIPE_LISTENING = 536
local BUFFER_SIZE = 65536
local INVALID_HANDLE_VALUE = ffi.cast('HANDLE', -1)

local pipe
local connected = false
local codec
local on_disconnect
local read_buffer = ffi.new('char[?]', BUFFER_SIZE)
local bytes_read = ffi.new('DWORD[1]')
local bytes_written = ffi.new('DWORD[1]')

local function log(message)
  if sendDebugMessage then
    sendDebugMessage('MCP: ' .. tostring(message), 'balatro_mcp')
  end
end

local function disconnect(reason)
  if not pipe then return end
  kernel32.DisconnectNamedPipe(pipe)
  if connected then
    log(reason and ('Named-pipe client closed: ' .. reason) or 'Named-pipe client disconnected')
  end
  connected = false
  codec.reset()
  on_disconnect()
end

local function accept_client()
  if not pipe or connected then return end

  local accepted = kernel32.ConnectNamedPipe(pipe, nil)
  if accepted ~= 0 then return end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_PIPE_CONNECTED then
    connected = true
    codec.reset()
    log('Named-pipe client connected')
  elseif error_code == ERROR_NO_DATA then
    disconnect('previous client closed')
  elseif error_code ~= ERROR_PIPE_LISTENING then
    log('Named-pipe accept failed (error ' .. error_code .. ')')
  end
end

local function read_client()
  if not connected then return end
  bytes_read[0] = 0
  local read = kernel32.ReadFile(pipe, read_buffer, BUFFER_SIZE, bytes_read, nil)
  local count = tonumber(bytes_read[0])
  if read ~= 0 and count > 0 then
    local ok, err = codec.feed(ffi.string(read_buffer, count))
    if not ok then disconnect(err) end
    return
  end
  if read ~= 0 then return end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_NO_DATA then return end
  if error_code == ERROR_BROKEN_PIPE or error_code == ERROR_PIPE_NOT_CONNECTED then
    disconnect('peer disconnected')
  else
    disconnect('read failed (error ' .. error_code .. ')')
  end
end

local function flush_client()
  if not connected then return false end
  local payload = codec.pending()
  if payload == '' then return true end

  bytes_written[0] = 0
  local written = kernel32.WriteFile(pipe, payload, #payload, bytes_written, nil)
  if written ~= 0 then
    codec.consume(tonumber(bytes_written[0]))
    return true
  end
  disconnect('write failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
  return false
end

function SocketServer.init(on_request, socket_codec, disconnect_callback)
  if pipe then return true end
  codec = socket_codec.new(on_request, log)
  on_disconnect = disconnect_callback
  pipe = kernel32.CreateNamedPipeA(
    PIPE_NAME,
    PIPE_ACCESS_DUPLEX,
    PIPE_NOWAIT + PIPE_REJECT_REMOTE_CLIENTS,
    1,
    BUFFER_SIZE,
    BUFFER_SIZE,
    0,
    nil
  )
  if pipe == INVALID_HANDLE_VALUE then
    log('Named-pipe creation failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
    pipe = nil
    return false
  end

  log('Named-pipe server listening on ' .. PIPE_NAME)
  return true
end

function SocketServer.update()
  accept_client()
  flush_client()
  read_client()
  flush_client()
end

function SocketServer.send_response(response)
  if not connected then return false end
  local queued, encode_error = codec.queue(response)
  if not queued then
    disconnect(encode_error)
    return false
  end
  return flush_client()
end

function SocketServer.close()
  if not pipe then return end
  disconnect()
  kernel32.CloseHandle(pipe)
  pipe = nil
  log('Named-pipe server closed')
end

return SocketServer
