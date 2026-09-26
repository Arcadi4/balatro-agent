local ffi = require('ffi')
local kernel32 = ffi.load('kernel32')

ffi.cdef([[
  typedef void *HANDLE;
  typedef int BOOL;
  typedef unsigned int UINT;
  typedef unsigned long DWORD;
  typedef unsigned short WCHAR;
  typedef struct {
    DWORD cb; void *lpReserved; void *lpDesktop; void *lpTitle;
    DWORD dwX; DWORD dwY; DWORD dwXSize; DWORD dwYSize;
    DWORD dwXCountChars; DWORD dwYCountChars; DWORD dwFillAttribute; DWORD dwFlags;
    unsigned short wShowWindow; unsigned short cbReserved2; void *lpReserved2;
    HANDLE hStdInput; HANDLE hStdOutput; HANDLE hStdError;
  } STARTUPINFOW;
  typedef struct { HANDLE hProcess; HANDLE hThread; DWORD dwProcessId; DWORD dwThreadId; } PROCESS_INFORMATION;
  DWORD GetCurrentProcessId(void);
  int MultiByteToWideChar(UINT code_page, DWORD flags, const char *input, int input_length, WCHAR *output, int output_length);
  BOOL CreateProcessW(const WCHAR *application_name, WCHAR *command_line, void *process_attributes, void *thread_attributes, BOOL inherit_handles, DWORD creation_flags, void *environment, const WCHAR *current_directory, STARTUPINFOW *startup_info, PROCESS_INFORMATION *process_information);
  HANDLE CreateJobObjectW(void *attributes, const WCHAR *name);
  BOOL AssignProcessToJobObject(HANDLE job, HANDLE process);
  BOOL TerminateJobObject(HANDLE job, unsigned int exit_code);
  BOOL CloseHandle(HANDLE object);
]])

local Process = {}
local CREATE_NO_WINDOW = 0x08000000
local CP_UTF8 = 65001

local function quote(argument)
  return '"' .. argument:gsub('([\\"])', '\\%1') .. '"'
end

local function wide(value)
  local length = kernel32.MultiByteToWideChar(CP_UTF8, 0, value, #value, nil, 0)
  if length == 0 then return nil end
  local buffer = ffi.new('WCHAR[?]', length + 1)
  if kernel32.MultiByteToWideChar(CP_UTF8, 0, value, #value, buffer, length) == 0 then return nil end
  return buffer
end

function Process.parent_pid()
  return tonumber(kernel32.GetCurrentProcessId())
end

function Process.spawn(args)
  local quoted = {}
  for index, argument in ipairs(args) do quoted[index] = quote(argument) end
  local command = wide('cmd.exe /d /s /c ""' .. table.concat(quoted, ' ') .. '""')
  if not command then return nil end
  local startup = ffi.new('STARTUPINFOW')
  startup.cb = ffi.sizeof(startup)
  local process_info = ffi.new('PROCESS_INFORMATION')
  if kernel32.CreateProcessW(nil, command, nil, nil, 0, CREATE_NO_WINDOW, nil, nil, startup, process_info) == 0 then return nil end
  local job = kernel32.CreateJobObjectW(nil, nil)
  if job == nil or kernel32.AssignProcessToJobObject(job, process_info.hProcess) == 0 then
    kernel32.CloseHandle(process_info.hProcess)
    kernel32.CloseHandle(process_info.hThread)
    if job ~= nil then kernel32.CloseHandle(job) end
    return nil
  end
  kernel32.CloseHandle(process_info.hProcess)
  kernel32.CloseHandle(process_info.hThread)
  return job
end

function Process.stop(job)
  kernel32.TerminateJobObject(job, 0)
  kernel32.CloseHandle(job)
end

return Process
