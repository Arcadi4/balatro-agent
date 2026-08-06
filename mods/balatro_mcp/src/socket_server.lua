--- socket_server.lua — Cross-platform non-blocking socket server for Balatro MCP.
--- Protocol: newline-delimited JSON messages.
---
--- Backends:
---   - macOS (ffi.os == "OSX"):   Unix domain socket at /tmp/balatro-mcp.sock
---   - Windows (ffi.os == "Windows"): TCP loopback at 127.0.0.1:PORT (Winsock2)
---
--- Exposes the same public interface as before so commands.lua / jsonrpc.lua
--- are unaffected: init(), update(dt), close(), send_response(json), and the
--- on_request_callback field.

local ffi = require("ffi")
local C = ffi.C

local IS_WINDOWS = ffi.os == "Windows"

local SOCKET_PATH = "/tmp/balatro-mcp.sock"
local HOST = "127.0.0.1"

-- Windows bridge port. Overridable via BALATRO_BRIDGE_PORT to match the MCP
-- server; falls back to the protocol default (37651).
local PORT = 37651
if IS_WINDOWS then
  local env_port = os.getenv and os.getenv("BALATRO_BRIDGE_PORT")
  local parsed = env_port and tonumber(env_port)
  if parsed and parsed >= 1 and parsed <= 65535 then
    PORT = math.floor(parsed)
  end
end
local READ_BUFFER_SIZE = 4096
local MAX_LINE_BUFFER_SIZE = 65536

local EAGAIN
local EWOULDBLOCK
local WSAEWOULDBLOCK = 10035

local server_fd = -1
local client_fd = -1
local initialized = false
local has_client = false
local line_buffer = ""
local read_buffer = ffi.new("char[?]", READ_BUFFER_SIZE)

local SocketServer = {}

SocketServer.on_request_callback = nil

-- Winsock handle (Windows). Loaded lazily inside the `if IS_WINDOWS` block to
-- keep it available to the error helpers defined below. Nil on POSIX.
local W

local function log(message)
  if sendDebugMessage then
    pcall(sendDebugMessage, "MCP: " .. tostring(message))
  end
end

local function errno_message(prefix)
  return prefix .. " (errno " .. tostring(last_wsa_error()) .. ")"
end

-- Winsock uses WSAGetLastError() instead of errno; values are positive (e.g. 10035).
-- LuaJIT ffi.errno()/errno number is only meaningful on POSIX.
local function last_wsa_error()
  if IS_WINDOWS and W then
    return W.WSAGetLastError()
  end
  return ffi.errno()
end

local function errno_is_would_block(errno)
  return errno == EAGAIN or errno == EWOULDBLOCK or errno == WSAEWOULDBLOCK
end

---------------------------------------------------------------------------
-- Winsock2 backend (Windows)
---------------------------------------------------------------------------

if IS_WINDOWS then
  W = ffi.load("ws2_32")

  ffi.cdef[[
    typedef unsigned long u_long;
    typedef struct {
      unsigned short sin_family;
      unsigned short sin_port;
      unsigned long sin_addr;
      char sin_zero[8];
    } sockaddr_in;

    int WSAStartup(unsigned short wVersionRequested, void *lpWSAData);
    void WSACleanup(void);
    int WSAGetLastError(void);
    intptr_t socket(int af, int type, int protocol);
    int bind(intptr_t s, const void *name, int namelen);
    int listen(intptr_t s, int backlog);
    intptr_t accept(intptr_t s, void *addr, int *addrlen);
    int closesocket(intptr_t s);
    int ioctlsocket(intptr_t s, long cmd, u_long *argp);
    long recv(intptr_t s, void *buf, unsigned long len, int flags);
    long send(intptr_t s, const void *buf, unsigned long len, int flags);
    int select(int nfds, void *readfds, void *writefds, void *exceptfds, void *timeout);
    unsigned long inet_addr(const char *cp);
    unsigned short htons(unsigned short hostshort);
    int setsockopt(intptr_t s, int level, int optname, const void *optval, int optlen);
    typedef struct {
      unsigned long fd_count;
      uintptr_t fd_array[64];
    } fd_set_arr;
    typedef struct {
      long tv_sec;
      long tv_usec;
    } timeval;
  ]]

  -- WSADATA size on Windows (approx 408 bytes); zero-init is enough for WSAStartup
  local wsadata = ffi.new("char[?]", 512)

  -- Constants
  local AF_INET = 2
  local SOCK_STREAM = 1
  local IPPROTO_TCP = 6
  local SOL_SOCKET = 0xffff
  local SO_REUSEADDR = 0x0004
  -- FIONBIO = 0x8004667e, 但 LuaJIT 的 long 参数是 32 位有符号，必须用有符号表示
  local FIONBIO = -2147195266
  local MAKEWORD = 0x0202  -- request Winsock 2.2
  local SOCKET_ERROR = -1

  -- Non-blocking flag
  local function set_nonblocking(fd)
    local one = ffi.new("u_long[1]", 1)
    if W.ioctlsocket(fd, FIONBIO, one) ~= 0 then
      return false, errno_message("ioctlsocket(FIONBIO) failed")
    end
    return true
  end

  -- select() readiness check against a single fd (read ready)
  -- Returns (readable, error_flag, errno)
  local fdset = ffi.new("fd_set_arr")
  local tv = ffi.new("timeval")
  tv.tv_sec = 0
  tv.tv_usec = 0

  local function fd_set_zero()
    ffi.fill(fdset, ffi.sizeof(fdset), 0)
  end

  local function fd_set_add(fd)
    fdset.fd_array[fdset.fd_count] = fd
    fdset.fd_count = fdset.fd_count + 1
  end

  local function fd_set_isset(fd)
    for i = 0, tonumber(fdset.fd_count) - 1 do
      if tonumber(fdset.fd_array[i]) == fd then
        return true
      end
    end
    return false
  end

  local function poll_readable(fd)
    fd_set_zero()
    local n = 0
    -- select with a single fd: use fd_set wrapper
    fd_set_add(fd)
    n = W.select(0, fdset, nil, nil, tv)
    if n == SOCKET_ERROR then
      return false, true, last_wsa_error()
    end
    if n == 0 then
      return false, false, nil
    end
    return fd_set_isset(fd), false, nil
  end

  local function create_server()
    if W.WSAStartup(MAKEWORD, wsadata) ~= 0 then
      return -1, "WSAStartup failed"
    end

    local fd = W.socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
    if fd == SOCKET_ERROR then
      W.WSACleanup()
      return -1, "socket() failed"
    end

    -- SO_REUSEADDR to avoid TIME_WAIT issues on restart
    local opt = ffi.new("int[1]", 1)
    W.setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, opt, ffi.sizeof("int"))

    local ok, err = set_nonblocking(fd)
    if not ok then
      W.closesocket(fd)
      W.WSACleanup()
      return -1, err
    end

    local addr = ffi.new("sockaddr_in")
    addr.sin_family = AF_INET
    addr.sin_port = W.htons(PORT)
    addr.sin_addr = W.inet_addr(HOST)

    if W.bind(fd, addr, ffi.sizeof(addr)) ~= 0 then
      W.closesocket(fd)
      W.WSACleanup()
      return -1, "bind() failed on " .. HOST .. ":" .. PORT
    end

    if W.listen(fd, 1) ~= 0 then
      W.closesocket(fd)
      W.WSACleanup()
      return -1, "listen() failed"
    end

    return fd, nil
  end

  SocketServer.get_endpoint = function()
    return HOST .. ":" .. PORT
  end

  local function accept_pending_client()
    if server_fd < 0 then return end
    local readable, failed = poll_readable(server_fd)
    if failed then
      log("Socket accept poll failed")
      return
    end
    if not readable then return end

    local accepted_fd = W.accept(server_fd, nil, nil)
    if accepted_fd == SOCKET_ERROR then
      local err = last_wsa_error()
      if not errno_is_would_block(err) then
        log("Socket accept failed (errno " .. tostring(err) .. ")")
      end
      return
    end

    if has_client then
      W.closesocket(accepted_fd)
      log("Rejected extra socket client; one client is already connected")
      return
    end

    local ok, err = set_nonblocking(accepted_fd)
    if not ok then
      W.closesocket(accepted_fd)
      log("Accepted socket client but failed to make it non-blocking: " .. tostring(err))
      return
    end

    client_fd = accepted_fd
    has_client = true
    line_buffer = ""
    log("Socket client connected (" .. SocketServer.get_endpoint() .. ")")
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

  local function close_client(reason)
    if has_client and client_fd >= 0 then
      W.closesocket(client_fd)
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

  local function read_from_client()
    if not has_client or client_fd < 0 then return end

    local readable, failed = poll_readable(client_fd)
    if failed then
      log("Socket client poll failed")
      close_client("poll failed")
      return
    end
    if not readable then return end

    local bytes_read = W.recv(client_fd, read_buffer, READ_BUFFER_SIZE, 0)
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

    local err = last_wsa_error()
    if not errno_is_would_block(err) then
      log("Socket recv failed (errno " .. tostring(err) .. ")")
      close_client("recv failed")
    end
  end

  SocketServer.init = function()
    if initialized then return true end

    local fd, err = create_server()
    if fd < 0 then
      log("Socket server init failed: " .. tostring(err))
      return false
    end

    server_fd = fd
    initialized = true
    log("Socket server listening on " .. SocketServer.get_endpoint())
    return true
  end

  SocketServer.update = function(dt)
    if not initialized then return end
    accept_pending_client()
    read_from_client()
  end

  SocketServer.send_response = function(response_json)
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
    local bytes_written = W.send(client_fd, payload, #payload, 0)
    if bytes_written == SOCKET_ERROR then
      local err = last_wsa_error()
      if not errno_is_would_block(err) then
        log("Socket response send failed (errno " .. tostring(err) .. ")")
        close_client("send failed")
      end
      return false
    end

    if bytes_written < #payload then
      log("Socket response send was partial; closing client")
      close_client("partial send")
      return false
    end

    return true
  end

  SocketServer.close = function()
    close_client(nil)
    if server_fd >= 0 then
      W.closesocket(server_fd)
      server_fd = -1
    end
    W.WSACleanup()
    initialized = false
    log("Socket server closed")
  end
end

---------------------------------------------------------------------------
-- POSIX backend (macOS / Linux) — Unix domain socket
---------------------------------------------------------------------------

if not IS_WINDOWS then
  C = ffi.C

  ffi.cdef[[
    struct sockaddr;
    int socket(int domain, int type, int protocol);
    int bind(int sockfd, const struct sockaddr *addr, unsigned int addrlen);
    int listen(int sockfd, int backlog);
    int accept(int sockfd, struct sockaddr *addr, unsigned int *addrlen);
    int close(int fd);
    long read(int fd, void *buf, unsigned long count);
    long write(int fd, const void *buf, unsigned long count);
    int fcntl(int fd, int cmd, ...);
    typedef unsigned int nfds_t;
    typedef struct pollfd {
      int fd;
      short events;
      short revents;
    } pollfd;
    int poll(struct pollfd *fds, nfds_t nfds, int timeout);

    typedef struct {
      unsigned char sun_len;
      unsigned char sun_family;
      char sun_path[104];
    } sockaddr_un;

    static const int AF_UNIX = 1;
    static const int SOCK_STREAM = 1;
    static const int O_NONBLOCK = 0x0004;
    static const int F_SETFL = 4;
    static const int F_GETFL = 3;
    static const int SOL_SOCKET = 1;
    static const int SO_REUSEADDR = 2;
    static const short POLLIN = 0x0001;
    static const short POLLHUP = 0x0010;
    static const short POLLERR = 0x0008;
  ]]

  EAGAIN = ffi.os == "OSX" and 35 or 11
  EWOULDBLOCK = EAGAIN

  local poll_fds = ffi.new("pollfd[1]")

  local function errno_is_would_block(errno)
    return errno == EAGAIN or errno == EWOULDBLOCK
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

  local function poll_readable(fd)
    poll_fds[0].fd = fd
    poll_fds[0].events = C.POLLIN
    poll_fds[0].revents = 0
    local ready = C.poll(poll_fds, 1, 0)
    if ready < 0 then
      local errno = ffi.errno()
      return false, true, errno
    end
    if ready == 0 then
      return false, false, nil
    end
    local revents = tonumber(poll_fds[0].revents) or 0
    if math.floor(revents / tonumber(C.POLLERR)) % 2 == 1 then
      return false, true, nil
    end
    if math.floor(revents / tonumber(C.POLLHUP)) % 2 == 1 then
      return false, true, nil
    end
    return math.floor(revents / tonumber(C.POLLIN)) % 2 == 1, false, nil
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
    local readable, failed, errno = poll_readable(server_fd)
    if failed then
      log("Socket accept poll failed" .. (errno and (" (errno " .. tostring(errno) .. ")") or ""))
      return
    end
    if not readable then return end
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

  local function read_from_client()
    if not has_client or client_fd < 0 then return end
    local readable, failed, errno = poll_readable(client_fd)
    if failed then
      log("Socket client poll failed" .. (errno and (" (errno " .. tostring(errno) .. ")") or ""))
      close_client("poll failed")
      return
    end
    if not readable then return end
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

  SocketServer.init = function()
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
    addr.sun_len = ffi.sizeof(addr)
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

  SocketServer.update = function(dt)
    if not initialized then return end
    accept_pending_client()
    read_from_client()
  end

  SocketServer.send_response = function(response_json)
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

  SocketServer.close = function()
    close_client(nil)
    if server_fd >= 0 then
      C.close(server_fd)
      server_fd = -1
    end
    os.remove(SOCKET_PATH)
    initialized = false
    log("Socket server closed")
  end
end

return SocketServer
