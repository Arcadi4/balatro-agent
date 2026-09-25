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
  if jit.os ~= 'Windows' and base:sub(-5) == '.sock' then
    return base:sub(1, -6) .. '-' .. instance_id .. '.sock'
  end
  return base .. '-' .. instance_id
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
  local file = io.open(record_path, 'w')
  if not file then return false end
  file:write(instance_id, '\t', endpoint(), '\t', tostring(os.time() * 1000), '\n')
  file:close()
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
end

return Instance
