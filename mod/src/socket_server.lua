local ffi = require('ffi')
local bit = require('bit')
local C = ffi.C

ffi.cdef([[
  struct sockaddr;
  int socket(int domain, int type, int protocol);
  int bind(int sockfd, const struct sockaddr *addr, unsigned int addrlen);
  int listen(int sockfd, int backlog);
  int accept(int sockfd, struct sockaddr *addr, unsigned int *addrlen);
  int close(int fd);
  long read(int fd, void *buf, unsigned long count);
  long write(int fd, const void *buf, unsigned long count);
  int fcntl(int fd, int cmd, ...);

  typedef struct pollfd {
    int fd;
    short events;
    short revents;
  } pollfd;

  typedef struct {
    unsigned char sun_len;
    unsigned char sun_family;
    char sun_path[104];
  } sockaddr_un_macos;

  typedef struct {
    unsigned short sun_family;
    char sun_path[108];
  } sockaddr_un_linux;
]])

if ffi.os == 'OSX' then
  ffi.cdef('int poll(struct pollfd *fds, unsigned int nfds, int timeout);')
else
  ffi.cdef('int poll(struct pollfd *fds, unsigned long nfds, int timeout);')
end

local SocketServer = {}

local READ_BUFFER_SIZE = 4096
local AF_UNIX = 1
local SOCK_STREAM = 1
local F_GETFL = 3
local F_SETFL = 4
local O_NONBLOCK = ffi.os == 'OSX' and 0x0004 or 0x0800
local POLLIN = 0x0001
local POLLHUP = 0x0010
local POLLERR = 0x0008
local EAGAIN = ffi.os == 'OSX' and 35 or 11

local server_fd = -1
local clients = {}
local socket_path
local instance
local on_disconnect
local request_handler
local socket_codec_factory
local flush_client
local poll_fds = ffi.new('pollfd[1]')

local function log(message)
  if sendDebugMessage then
    sendDebugMessage('MCP: ' .. tostring(message), 'balatro-agent')
  end
end

local function errno_message(prefix)
  return prefix .. ' (errno ' .. tostring(ffi.errno()) .. ')'
end

local function set_nonblocking(fd)
  local flags = C.fcntl(fd, F_GETFL)
  if flags < 0 then return false, errno_message('fcntl(F_GETFL) failed') end
  local nonblocking_flags = ffi.cast('int', bit.bor(tonumber(flags), O_NONBLOCK))
  if C.fcntl(fd, F_SETFL, nonblocking_flags) < 0 then
    return false, errno_message('fcntl(F_SETFL) failed')
  end
  return true
end

local function poll_readable(fd)
  poll_fds[0].fd = fd
  poll_fds[0].events = POLLIN
  poll_fds[0].revents = 0

  local ready = C.poll(poll_fds, 1, 0)
  if ready < 0 then
    local errno = ffi.errno()
    return false, errno ~= EAGAIN, errno
  end
  if ready == 0 then return false, false end

  local revents = tonumber(poll_fds[0].revents)
  if bit.band(revents, bit.bor(POLLERR, POLLHUP)) ~= 0 then
    return false, true
  end
  return bit.band(revents, POLLIN) ~= 0, false
end

local function close_client(client, reason)
  if not client or not clients[client.fd] then return end
  clients[client.fd] = nil
  C.close(client.fd)
  client.codec.reset()
  on_disconnect(client)
  log(reason and ('Socket client closed: ' .. reason) or 'Socket client disconnected')
end

local function send_response(client, response)
  if not client or not clients[client.fd] then return false end
  local queued, encode_error = client.codec.queue(response)
  if not queued then
    close_client(client, encode_error)
    return false
  end
  return flush_client(client)
end

local function accept_client()
  if server_fd < 0 then return end
  local readable, failed, errno = poll_readable(server_fd)
  if failed then
    log('Socket accept poll failed' .. (errno and (' (errno ' .. errno .. ')') or ''))
    return
  end
  if not readable then return end

  local accepted_fd = C.accept(server_fd, nil, nil)
  if accepted_fd < 0 then
    local accept_errno = ffi.errno()
    if accept_errno ~= EAGAIN then log('Socket accept failed (errno ' .. accept_errno .. ')') end
    return
  end

  local ok, err = set_nonblocking(accepted_fd)
  if not ok then
    C.close(accepted_fd)
    log(err)
    return
  end

  local client = {
    fd = accepted_fd,
    buffer = ffi.new('char[?]', READ_BUFFER_SIZE),
    codec = socket_codec_factory.new(function(request)
      request_handler(request, function(response)
        send_response(client, response)
      end, client)
    end, log),
  }
  clients[accepted_fd] = client
  log('Socket client connected')
end

local function read_client(client)
  local readable, failed, errno = poll_readable(client.fd)
  if failed then
    close_client(client, 'poll failed' .. (errno and (' (errno ' .. errno .. ')') or ''))
    return
  end
  if not readable then return end

  local bytes_read = C.read(client.fd, client.buffer, READ_BUFFER_SIZE)
  if bytes_read > 0 then
    local ok, err = client.codec.feed(ffi.string(client.buffer, bytes_read))
    if not ok then close_client(client, err) end
  elseif bytes_read == 0 then
    close_client(client, 'peer disconnected')
  elseif ffi.errno() ~= EAGAIN then
    close_client(client, errno_message('read failed'))
  end
end

flush_client = function(client)
  if not clients[client.fd] then return false end
  local payload = client.codec.pending()
  if payload == '' then return true end

  local bytes_written = C.write(client.fd, payload, #payload)
  if bytes_written > 0 then
    client.codec.consume(tonumber(bytes_written))
  elseif ffi.errno() ~= EAGAIN then
    close_client(client, errno_message('write failed'))
    return false
  end
  return true
end

function SocketServer.init(on_request, socket_codec, disconnect_callback, bridge_instance)
  if server_fd >= 0 then return true end
  instance = bridge_instance
  request_handler = on_request
  socket_codec_factory = socket_codec
  socket_path = instance.endpoint()
  on_disconnect = disconnect_callback

  local fd = C.socket(AF_UNIX, SOCK_STREAM, 0)
  if fd < 0 then
    log(errno_message('Socket creation failed'))
    return false
  end

  local ok, err = set_nonblocking(fd)
  if not ok then
    C.close(fd)
    log(err)
    return false
  end

  local address_type = ffi.os == 'OSX' and 'sockaddr_un_macos' or 'sockaddr_un_linux'
  local address = ffi.new(address_type)
  if #socket_path >= ffi.sizeof(address.sun_path) then
    C.close(fd)
    log('Socket path is too long: ' .. socket_path)
    return false
  end
  if ffi.os == 'OSX' then address.sun_len = ffi.sizeof(address) end
  address.sun_family = AF_UNIX
  ffi.copy(address.sun_path, socket_path, #socket_path)

  os.remove(socket_path)
  if C.bind(fd, ffi.cast('const struct sockaddr *', address), ffi.sizeof(address)) < 0 then
    log(errno_message('Socket bind failed'))
    C.close(fd)
    return false
  end
  if C.listen(fd, 16) < 0 then
    log(errno_message('Socket listen failed'))
    C.close(fd)
    os.remove(socket_path)
    return false
  end

  server_fd = fd
  if not instance.publish() then
    log('Instance registry publication failed')
    SocketServer.close()
    return false
  end
  log('Socket server listening on ' .. socket_path)
  return true
end

function SocketServer.update()
  if server_fd < 0 then return end
  accept_client()
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
  if server_fd >= 0 then
    C.close(server_fd)
    server_fd = -1
  end
  if socket_path then os.remove(socket_path) end
  if instance then instance.remove() end
  log('Socket server closed')
end

return SocketServer
