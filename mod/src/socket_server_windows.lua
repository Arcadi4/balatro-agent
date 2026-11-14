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

local PIPE_ACCESS_DUPLEX = 0x00000003
local PIPE_NOWAIT = 0x00000001
local PIPE_REJECT_REMOTE_CLIENTS = 0x00000008
local PIPE_UNLIMITED_INSTANCES = 255
local ERROR_BROKEN_PIPE = 109
local ERROR_NO_DATA = 232
local ERROR_PIPE_NOT_CONNECTED = 233
local ERROR_PIPE_CONNECTED = 535
local ERROR_PIPE_LISTENING = 536
local BUFFER_SIZE = 65536
local INVALID_HANDLE_VALUE = ffi.cast('HANDLE', -1)

local STOPPED = 'stopped'
local LISTENING = 'listening'
local AWAITING_LISTENER = 'awaiting-listener'
local CLIENT_OPEN = 'open'
local CLIENT_CLOSED = 'closed'

local server = { state = STOPPED }
local clients = {}
local pipe_name
local on_disconnect
local request_handler
local socket_codec_factory
local bytes_read = ffi.new('DWORD[1]')
local bytes_written = ffi.new('DWORD[1]')
local flush_client

local function log(message)
  if sendDebugMessage then
    sendDebugMessage('MCP: ' .. tostring(message), 'balatro-agent')
  end
end

local function create_pipe()
  return kernel32.CreateNamedPipeA(
    pipe_name,
    PIPE_ACCESS_DUPLEX,
    PIPE_NOWAIT + PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_UNLIMITED_INSTANCES,
    BUFFER_SIZE,
    BUFFER_SIZE,
    0,
    nil
  )
end

local function is_active()
  -- A failed listener leaves the server AWAITING_LISTENER instead of STOPPED: accepted
  -- clients must keep being read and flushed, and only `stop_server` ends them.
  return server.state == LISTENING or server.state == AWAITING_LISTENER
end

local function create_listener(failure_message)
  local handle = create_pipe()
  if handle == INVALID_HANDLE_VALUE then
    log(failure_message .. ' (error ' .. tonumber(kernel32.GetLastError()) .. ')')
    return false
  end
  server.state = LISTENING
  server.handle = handle
  return true
end

local function is_open(client)
  return client ~= nil and client.state == CLIENT_OPEN and clients[client.pipe] == client
end

local function close_client(client, reason)
  if client == nil or client.state ~= CLIENT_OPEN then return false end
  client.state = CLIENT_CLOSED
  if clients[client.pipe] == client then clients[client.pipe] = nil end
  kernel32.DisconnectNamedPipe(client.pipe)
  kernel32.CloseHandle(client.pipe)
  client.codec.reset()
  on_disconnect(client)
  log(reason and ('Named-pipe client closed: ' .. reason) or 'Named-pipe client disconnected')
  return true
end

local function send_response(client, response)
  if not is_open(client) then return false end
  local queued, encode_error = client.codec.queue(response)
  if not queued then
    close_client(client, encode_error)
    return false
  end
  return flush_client(client)
end

local function adopt_client(handle)
  server.state = AWAITING_LISTENER
  server.handle = nil

  local client
  client = {
    state = CLIENT_OPEN,
    pipe = handle,
    buffer = ffi.new('char[?]', BUFFER_SIZE),
    codec = socket_codec_factory.new(function(request)
      request_handler(request, function(response)
        send_response(client, response)
      end, client)
    end, log),
  }
  clients[handle] = client
  log('Named-pipe client connected')

  create_listener('Named-pipe listener creation failed')
end

local function accept_client()
  if server.state ~= LISTENING then return end
  local handle = server.handle
  local accepted = kernel32.ConnectNamedPipe(handle, nil)
  if accepted ~= 0 then
    adopt_client(handle)
    return
  end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_PIPE_CONNECTED then
    adopt_client(handle)
  elseif error_code == ERROR_NO_DATA then
    kernel32.CloseHandle(handle)
    server.state = AWAITING_LISTENER
    server.handle = nil
    create_listener('Named-pipe listener creation failed')
  elseif error_code ~= ERROR_PIPE_LISTENING then
    log('Named-pipe accept failed (error ' .. error_code .. ')')
  end
end

local function read_client(client)
  if not is_open(client) then return end
  bytes_read[0] = 0
  local read = kernel32.ReadFile(client.pipe, client.buffer, BUFFER_SIZE, bytes_read, nil)
  local count = tonumber(bytes_read[0])
  if read ~= 0 and count > 0 then
    local ok, err = client.codec.feed(ffi.string(client.buffer, count))
    if not ok then close_client(client, err) end
    return
  end
  if read ~= 0 then return end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_NO_DATA then return end
  if error_code == ERROR_BROKEN_PIPE or error_code == ERROR_PIPE_NOT_CONNECTED then
    close_client(client, 'peer disconnected')
  else
    close_client(client, 'read failed (error ' .. error_code .. ')')
  end
end

flush_client = function(client)
  if not is_open(client) then return false end
  local payload = client.codec.pending()
  if payload == '' then return true end

  local written = kernel32.WriteFile(client.pipe, payload, #payload, bytes_written, nil)
  if written ~= 0 then
    client.codec.consume(tonumber(bytes_written[0]))
    return true
  end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_NO_DATA then return true end
  if error_code == ERROR_BROKEN_PIPE or error_code == ERROR_PIPE_NOT_CONNECTED then
    close_client(client, 'peer disconnected')
  else
    close_client(client, 'write failed (error ' .. error_code .. ')')
  end
  return false
end

local function stop_server(reason)
  if not is_active() then return false end
  local handle = server.handle
  local owner = server.instance
  server = { state = STOPPED }
  for _, client in pairs(clients) do close_client(client, 'bridge shutdown') end
  if handle then kernel32.CloseHandle(handle) end
  owner.remove()
  log(reason)
  return true
end

function SocketServer.init(on_request, socket_codec, disconnect_callback, bridge_instance)
  if is_active() then return true end
  request_handler = on_request
  socket_codec_factory = socket_codec
  on_disconnect = disconnect_callback
  pipe_name = bridge_instance.endpoint()

  if not create_listener('Named-pipe creation failed') then
    return false
  end
  server.instance = bridge_instance
  if not bridge_instance.publish() then
    log('Instance registry publication failed')
    stop_server('Named-pipe server closed')
    return false
  end
  log('Named-pipe server listening on ' .. pipe_name)
  return true
end

function SocketServer.update()
  if not is_active() then return end
  if server.state == AWAITING_LISTENER then
    create_listener('Named-pipe listener creation failed')
  end
  if server.state == LISTENING then accept_client() end
  for _, client in pairs(clients) do
    flush_client(client)
    if client.state == CLIENT_OPEN then
      read_client(client)
      flush_client(client)
    end
  end
  server.instance.touch()
end

function SocketServer.send_response(response)
  return false
end

function SocketServer.close()
  stop_server('Named-pipe server closed')
end

return SocketServer
