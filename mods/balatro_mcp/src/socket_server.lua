--- socket_server.lua — Non-blocking Unix domain socket server for Balatro MCP.
--- Protocol: newline-delimited JSON messages over /tmp/balatro-mcp.sock.

local ffi = require("ffi")
local C = ffi.C

ffi.cdef[[
  struct sockaddr;
  typedef struct fd_set fd_set;

  // Socket creation and management
  int socket(int domain, int type, int protocol);
  int bind(int sockfd, const struct sockaddr *addr, unsigned int addrlen);
  int listen(int sockfd, int backlog);
  int accept(int sockfd, struct sockaddr *addr, unsigned int *addrlen);
  int close(int fd);

  // I/O
  int read(int fd, void *buf, unsigned int count);
  int write(int fd, const void *buf, unsigned int count);

  // Non-blocking
  int fcntl(int fd, int cmd, ...);

  // Select for non-blocking polling
  int select(int nfds, fd_set *readfds, fd_set *writefds, fd_set *errorfds, struct timeval *timeout);

  // Socket address
  typedef struct {
    unsigned short sun_family;
    char sun_path[108];
  } sockaddr_un;

  // timeval for select
  typedef struct timeval {
    long tv_sec;
    long tv_usec;
  } timeval;

  // Constants
  static const int AF_UNIX = 1;
  static const int SOCK_STREAM = 1;
  static const int O_NONBLOCK = 0x0004;  // macOS value
  static const int F_SETFL = 4;          // macOS value
  static const int F_GETFL = 3;          // macOS value
  static const int SOL_SOCKET = 1;       // macOS value
  static const int SO_REUSEADDR = 2;     // macOS value
]]

local SocketServer = {}

local SOCKET_PATH = "/tmp/balatro-mcp.sock"
local READ_BUFFER_SIZE = 4096
local EAGAIN = ffi.os == "OSX" and 35 or 11
local EWOULDBLOCK = EAGAIN

local server_fd = -1
local client_fd = -1
local initialized = false
local has_client = false
local line_buffer = ""
local read_buffer = ffi.new("char[?]", READ_BUFFER_SIZE)

SocketServer.on_request_callback = nil

local function log(message)
  if sendDebugMessage then
    pcall(sendDebugMessage, "MCP: " .. tostring(message))
  end
end

local function errno_is_would_block(errno)
  return errno == EAGAIN or errno == EWOULDBLOCK
end

local function errno_message(prefix)
  return prefix .. " (errno " .. tostring(ffi.errno()) .. ")"
end

local function set_nonblocking(fd)
  local flags = C.fcntl(fd, C.F_GETFL, 0)
  if flags < 0 then
    return false, errno_message("fcntl(F_GETFL) failed")
  end

  flags = tonumber(flags) or 0
  local nonblock = tonumber(C.O_NONBLOCK)
  local has_nonblock = math.floor(flags / nonblock) % 2 == 1
  local new_flags = has_nonblock and flags or (flags + nonblock)

  if C.fcntl(fd, C.F_SETFL, new_flags) < 0 then
    return false, errno_message("fcntl(F_SETFL) failed")
  end

  return true
end

local function close_client(reason)
  if has_client and client_fd >= 0 then
    C.close(client_fd)
    if reason then
      log("Socket client closed: " .. tostring(reason))
    else
      log("Socket client disconnected")
    end
  end

  client_fd = -1
  has_client = false
  line_buffer = ""
end

local function dispatch_line(line)
  if line == "" then return end
  if line:sub(-1) == "\r" then
    line = line:sub(1, -2)
  end
  if line == "" then return end

  if not JSON or not JSON.decode then
    log("Cannot decode socket request: JSON.decode unavailable")
    return
  end

  local decode_ok, decoded = pcall(JSON.decode, line)
  if not decode_ok or decoded == nil then
    log("Invalid JSON socket request: " .. tostring(decoded))
    return
  end

  local callback = SocketServer.on_request_callback
  if callback then
    local callback_ok, callback_err = pcall(callback, decoded)
    if not callback_ok then
      log("Socket request callback failed: " .. tostring(callback_err))
    end
  else
    log("Socket request received before callback was registered")
  end
end

local function process_line_buffer()
  while true do
    local newline_at = line_buffer:find("\n", 1, true)
    if not newline_at then return end

    local line = line_buffer:sub(1, newline_at - 1)
    line_buffer = line_buffer:sub(newline_at + 1)
    dispatch_line(line)
  end
end

local function accept_pending_client()
  if server_fd < 0 then return end

  local accepted_fd = C.accept(server_fd, nil, nil)
  if accepted_fd < 0 then
    local errno = ffi.errno()
    if not errno_is_would_block(errno) then
      log("Socket accept failed (errno " .. tostring(errno) .. ")")
    end
    return
  end

  if has_client then
    C.close(accepted_fd)
    log("Rejected extra socket client; one client is already connected")
    return
  end

  local ok, err = set_nonblocking(accepted_fd)
  if not ok then
    C.close(accepted_fd)
    log("Accepted socket client but failed to make it non-blocking: " .. tostring(err))
    return
  end

  client_fd = accepted_fd
  has_client = true
  line_buffer = ""
  log("Socket client connected")
end

local MAX_LINE_BUFFER_SIZE = 65536

local function read_from_client()
  if not has_client or client_fd < 0 then return end

  local bytes_read = C.read(client_fd, read_buffer, READ_BUFFER_SIZE)
  if bytes_read > 0 then
    line_buffer = line_buffer .. ffi.string(read_buffer, bytes_read)
    if #line_buffer > MAX_LINE_BUFFER_SIZE then
      log("Client exceeded max frame size, disconnecting")
      close_client("buffer overflow")
      return
    end
    process_line_buffer()
    return
  end

  if bytes_read == 0 then
    close_client("peer disconnected")
    return
  end

  local errno = ffi.errno()
  if not errno_is_would_block(errno) then
    log("Socket read failed (errno " .. tostring(errno) .. ")")
    close_client("read failed")
  end
end

function SocketServer.init()
  if initialized then return true end

  os.remove(SOCKET_PATH)

  local fd = C.socket(C.AF_UNIX, C.SOCK_STREAM, 0)
  if fd < 0 then
    log(errno_message("Socket creation failed"))
    return false
  end

  local ok, err = set_nonblocking(fd)
  if not ok then
    C.close(fd)
    log("Socket server non-blocking setup failed: " .. tostring(err))
    return false
  end

  local addr = ffi.new("sockaddr_un")
  addr.sun_family = C.AF_UNIX
  ffi.copy(addr.sun_path, SOCKET_PATH, #SOCKET_PATH)

  local bind_ok = C.bind(fd, ffi.cast("const struct sockaddr *", addr), ffi.sizeof(addr))
  if bind_ok < 0 then
    log(errno_message("Socket bind failed"))
    C.close(fd)
    os.remove(SOCKET_PATH)
    return false
  end

  if C.listen(fd, 1) < 0 then
    log(errno_message("Socket listen failed"))
    C.close(fd)
    os.remove(SOCKET_PATH)
    return false
  end

  server_fd = fd
  initialized = true
  log("Socket server listening on " .. SOCKET_PATH)
  return true
end

function SocketServer.update(dt)
  if not initialized then return end

  accept_pending_client()
  read_from_client()
end

function SocketServer.send_response(response_json)
  if not has_client or client_fd < 0 then
    log("Cannot send socket response: no client connected")
    return false
  end

  local payload = response_json
  if type(payload) ~= "string" then
    if not JSON or not JSON.encode then
      log("Cannot encode socket response: JSON.encode unavailable")
      close_client("response encode failed")
      return false
    end

    local encode_ok, encoded = pcall(JSON.encode, payload)
    if not encode_ok or type(encoded) ~= "string" then
      log("Failed to encode socket response: " .. tostring(encoded))
      close_client("response encode failed")
      return false
    end
    payload = encoded
  end

  payload = payload .. "\n"
  local bytes_written = C.write(client_fd, payload, #payload)
  if bytes_written < 0 then
    log("Socket response write failed (errno " .. tostring(ffi.errno()) .. ")")
    close_client("write failed")
    return false
  end

  if bytes_written < #payload then
    log("Socket response write was partial; closing client")
    close_client("partial write")
    return false
  end

  return true
end

function SocketServer.close()
  close_client(nil)

  if server_fd >= 0 then
    C.close(server_fd)
    server_fd = -1
  end

  os.remove(SOCKET_PATH)
  initialized = false
  log("Socket server closed")
end

return SocketServer
