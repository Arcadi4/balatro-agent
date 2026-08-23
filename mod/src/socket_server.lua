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

local SOCKET_PATH = os.getenv('BALATRO_BRIDGE_SOCKET') or '/tmp/balatro-mcp.sock'
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
local client_fd = -1
local codec
local on_disconnect
local read_buffer = ffi.new('char[?]', READ_BUFFER_SIZE)
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

local function close_client(reason)
  if client_fd < 0 then return end
  C.close(client_fd)
  client_fd = -1
  codec.reset()
  on_disconnect()
  log(reason and ('Socket client closed: ' .. reason) or 'Socket client disconnected')
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
  if client_fd >= 0 then
    C.close(accepted_fd)
    log('Rejected extra socket client; one client is already connected')
    return
  end

  local ok, err = set_nonblocking(accepted_fd)
  if not ok then
    C.close(accepted_fd)
    log('Failed to configure socket client: ' .. err)
    return
  end

  client_fd = accepted_fd
  codec.reset()
  log('Socket client connected')
end

local function read_client()
  if client_fd < 0 then return end
  local readable, failed, errno = poll_readable(client_fd)
  if failed then
    close_client('poll failed' .. (errno and (' (errno ' .. errno .. ')') or ''))
    return
  end
  if not readable then return end

  local bytes_read = C.read(client_fd, read_buffer, READ_BUFFER_SIZE)
  if bytes_read > 0 then
    local ok, err = codec.feed(ffi.string(read_buffer, bytes_read))
    if not ok then close_client(err) end
  elseif bytes_read == 0 then
    close_client('peer disconnected')
  elseif ffi.errno() ~= EAGAIN then
    close_client(errno_message('read failed'))
  end
end

local function flush_client()
  if client_fd < 0 then return false end
  local payload = codec.pending()
  if payload == '' then return true end

  local bytes_written = C.write(client_fd, payload, #payload)
  if bytes_written > 0 then
    codec.consume(tonumber(bytes_written))
  elseif bytes_written < 0 and ffi.errno() ~= EAGAIN then
    close_client(errno_message('write failed'))
    return false
  end
  return true
end

function SocketServer.init(on_request, socket_codec, disconnect_callback)
  if server_fd >= 0 then return true end
  codec = socket_codec.new(on_request, log)
  on_disconnect = disconnect_callback
  os.remove(SOCKET_PATH)

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
  if #SOCKET_PATH >= ffi.sizeof(address.sun_path) then
    C.close(fd)
    log('Socket path is too long: ' .. SOCKET_PATH)
    return false
  end
  if ffi.os == 'OSX' then address.sun_len = ffi.sizeof(address) end
  address.sun_family = AF_UNIX
  ffi.copy(address.sun_path, SOCKET_PATH, #SOCKET_PATH)

  if C.bind(fd, ffi.cast('const struct sockaddr *', address), ffi.sizeof(address)) < 0 then
    log(errno_message('Socket bind failed'))
    C.close(fd)
    os.remove(SOCKET_PATH)
    return false
  end
  if C.listen(fd, 1) < 0 then
    log(errno_message('Socket listen failed'))
    C.close(fd)
    os.remove(SOCKET_PATH)
    return false
  end

  server_fd = fd
  log('Socket server listening on ' .. SOCKET_PATH)
  return true
end

function SocketServer.update()
  accept_client()
  flush_client()
  read_client()
  flush_client()
end

function SocketServer.send_response(response)
  if client_fd < 0 then return false end
  local queued, encode_error = codec.queue(response)
  if not queued then
    close_client(encode_error)
    return false
  end
  return flush_client()
end

function SocketServer.close()
  close_client()
  if server_fd >= 0 then
    C.close(server_fd)
    server_fd = -1
  end
  os.remove(SOCKET_PATH)
  log('Socket server closed')
end

return SocketServer
