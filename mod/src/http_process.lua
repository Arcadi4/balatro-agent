local ffi = require('ffi')

ffi.cdef([[
  typedef int pid_t;
  typedef void *posix_spawnattr_t;
  int getpid(void);
  char ***_NSGetEnviron(void);
  extern char **environ;
  int posix_spawnp(
    pid_t *pid,
    const char *file,
    const void *file_actions,
    const posix_spawnattr_t *attrp,
    char *const argv[],
    char *const envp[]
  );
  int posix_spawnattr_init(posix_spawnattr_t *attr);
  int posix_spawnattr_destroy(posix_spawnattr_t *attr);
  int posix_spawnattr_setflags(posix_spawnattr_t *attr, short flags);
  int posix_spawnattr_setpgroup(posix_spawnattr_t *attr, pid_t pgroup);
  int kill(pid_t pid, int signal);
]])

local Process = {}
local POSIX_SPAWN_SETPGROUP = 0x0002
local SIGTERM = 15

function Process.parent_pid()
  return tonumber(ffi.C.getpid())
end

local function clean_environment()
  local raw_env = ffi.os == 'OSX' and ffi.C._NSGetEnviron()[0] or ffi.C.environ
  local kept = {}
  local index = 0
  while raw_env[index] ~= nil do
    local entry = ffi.string(raw_env[index])
    local key = entry:match('^([^=]+)=')
    if not (key and (key:match('^DYLD_') or key == 'LD_PRELOAD')) then
      table.insert(kept, raw_env[index])
    end
    index = index + 1
  end

  local env = ffi.new('char *[?]', #kept + 1)
  for i, ptr in ipairs(kept) do
    env[i - 1] = ptr
  end
  env[#kept] = nil
  return env
end

function Process.spawn(args)
  local argv = ffi.new('char *[?]', #args + 1)
  for index, argument in ipairs(args) do
    argv[index - 1] = ffi.cast('char *', argument)
  end

  local attributes = ffi.new('posix_spawnattr_t[1]')
  if ffi.C.posix_spawnattr_init(attributes) ~= 0 then return nil end
  if ffi.C.posix_spawnattr_setflags(attributes, POSIX_SPAWN_SETPGROUP) ~= 0
    or ffi.C.posix_spawnattr_setpgroup(attributes, 0) ~= 0 then
    ffi.C.posix_spawnattr_destroy(attributes)
    return nil
  end

  local pid = ffi.new('pid_t[1]')
  local environment = clean_environment()
  local result = ffi.C.posix_spawnp(pid, args[1], nil, attributes, argv, environment)
  ffi.C.posix_spawnattr_destroy(attributes)
  if result ~= 0 then return nil end
  return tonumber(pid[0])
end

function Process.stop(pid)
  ffi.C.kill(-pid, SIGTERM)
end

return Process
