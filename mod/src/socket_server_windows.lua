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

local listener
local clients = {}
local pipe_name
local instance
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

local function close_client(client, reason)
  if not client or not clients[client.pipe] then return end
  clients[client.pipe] = nil
  kernel32.DisconnectNamedPipe(client.pipe)
  kernel32.CloseHandle(client.pipe)
  client.codec.reset()
  on_disconnect(client)
  log(reason and ('Named-pipe client closed: ' .. reason) or 'Named-pipe client disconnected')
end

local function send_response(client, response)
  if not client or not clients[client.pipe] then return false end
  local queued, encode_error = client.codec.queue(response)
  if not queued then
    close_client(client, encode_error)
    return false
  end
  return flush_client(client)
end

local function accept_client()
  if not listener then return end
  local accepted = kernel32.ConnectNamedPipe(listener, nil)
  if accepted ~= 0 then return end

  local error_code = tonumber(kernel32.GetLastError())
  if error_code == ERROR_PIPE_CONNECTED then
    local client
    client = {
      pipe = listener,
      buffer = ffi.new('char[?]', BUFFER_SIZE),
      codec = socket_codec_factory.new(function(request)
        request_handler(request, function(response)
          send_response(client, response)
        end, client)
      end, log),
    }
    clients[listener] = client
    listener = create_pipe()
    if listener == INVALID_HANDLE_VALUE then
      listener = nil
      log('Named-pipe listener creation failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
      return
    end
    log('Named-pipe client connected')
  elseif error_code == ERROR_NO_DATA then
    kernel32.CloseHandle(listener)
    listener = create_pipe()
    if listener == INVALID_HANDLE_VALUE then
      listener = nil
      log('Named-pipe listener creation failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
    end
  elseif error_code ~= ERROR_PIPE_LISTENING then
    log('Named-pipe accept failed (error ' .. error_code .. ')')
  end
end

local function read_client(client)
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
  if not clients[client.pipe] then return false end
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

function SocketServer.init(on_request, socket_codec, disconnect_callback, bridge_instance)
  if listener then return true end
  instance = bridge_instance
  request_handler = on_request
  socket_codec_factory = socket_codec
  on_disconnect = disconnect_callback
  pipe_name = instance.endpoint()
  listener = create_pipe()
  if listener == INVALID_HANDLE_VALUE then
    log('Named-pipe creation failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
    listener = nil
    return false
  end
  if not instance.publish() then
    log('Instance registry publication failed')
    SocketServer.close()
    return false
  end
  log('Named-pipe server listening on ' .. pipe_name)
  return true
end

function SocketServer.update()
  if not listener then
    listener = create_pipe()
    if listener == INVALID_HANDLE_VALUE then
      listener = nil
      log('Named-pipe listener creation failed (error ' .. tonumber(kernel32.GetLastError()) .. ')')
    end
  end
  if listener then accept_client() end
  for _, client in pairs(clients) do
    flush_client(client)
    read_client(client)
    flush_client(client)
  end
  instance.touch()
end

function SocketServer.send_response(response)
  return false
end

function SocketServer.close()
  for _, client in pairs(clients) do close_client(client, 'bridge shutdown') end
  if listener then
    kernel32.CloseHandle(listener)
    listener = nil
  end
  if instance then instance.remove() end
  log('Named-pipe server closed')
end

return SocketServer
