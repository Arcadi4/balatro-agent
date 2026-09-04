local Sidecar = {}

local function log(message)
  if sendDebugMessage then
    sendDebugMessage('MCP: ' .. tostring(message), 'balatro-agent')
  end
end

function Sidecar.init(process_platform)
  platform = process_platform
end


function Sidecar.start(version, resource_tools, port)
  if process then return end
  assert(platform, 'HTTP sidecar process platform is not configured')

  local tail = {
    '--transport',
    'http',
    '--port',
    tostring(port),
    '--parent-pid',
    tostring(platform.parent_pid()),
  }
  if resource_tools then table.insert(tail, '--resource-tools') end

  local args
  local entry = os.getenv('BALATRO_MCP_ENTRY')
  if entry ~= nil and entry ~= '' then
    args = { 'node', entry }
    for _, argument in ipairs(tail) do table.insert(args, argument) end
  else
    args = {
      'npx',
      '--yes',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package=balatro-mcp@' .. version,
      'balatro-mcp',
    }
    for _, argument in ipairs(tail) do table.insert(args, argument) end
  end
  process = platform.spawn(args)
  if not process then
    log('Local HTTP server could not start: Node.js 20+ is required (plus npm for registry mode)')
    return
  end
  log('Starting local HTTP server at http://127.0.0.1:' .. tostring(port) .. '/mcp')
end


function Sidecar.shutdown()
  if not process then return end
  platform.stop(process)
  process = nil
end

return Sidecar
