local Instance = {}

math.randomseed(os.time())

local instance_id = tostring(os.time()) .. '-' .. tostring(math.random(0, 0x7fffffff))
local address = tostring({}):match('0x%x+') or '0'
instance_id = instance_id .. '-' .. address:gsub('0x', '')

local function socket_base()
  local override = os.getenv('BALATRO_BRIDGE_SOCKET')
  if override and override ~= '' then return override end
  if jit.os == 'Windows' then return '\\\\.\\pipe\\balatro-mcp' end
  return '/tmp/balatro-mcp'
end

local function endpoint()
  local base = socket_base()
  if jit.os == 'Windows' then return base .. '-' .. instance_id end
  if base:sub(-5) == '.sock' then base = base:sub(1, -6) end
  return base .. '-' .. instance_id .. '.sock'
end

local function registry_base()
  local override = os.getenv('BALATRO_BRIDGE_REGISTRY')
  if override and override ~= '' then return override end
  if jit.os == 'Windows' then
    local temp = os.getenv('TEMP') or os.getenv('TMP') or 'C:\\Temp'
    return temp .. '\\balatro-mcp'
  end
  return '/tmp/balatro-mcp'
end

local record_path = registry_base() .. '-' .. instance_id
local last_published = 0

local function write_record()
  local temporary_path = record_path .. '.tmp'
  local file = io.open(temporary_path, 'w')
  if not file then return false end
  file:write(instance_id, '\t', endpoint(), '\t', tostring(os.time() * 1000), '\n')
  file:close()

  local renamed = os.rename(temporary_path, record_path)
  if not renamed and jit.os == 'Windows' then
    os.remove(record_path)
    renamed = os.rename(temporary_path, record_path)
  end
  if not renamed then
    os.remove(temporary_path)
    return false
  end
  last_published = os.time()
  return true
end

function Instance.id()
  return instance_id
end

function Instance.endpoint()
  return endpoint()
end

function Instance.publish()
  return write_record()
end

function Instance.touch()
  if os.time() - last_published >= 1 then write_record() end
end

function Instance.remove()
  os.remove(record_path)
  os.remove(record_path .. '.tmp')
end

return Instance
