local mod = SMODS.current_mod
local mod_path = mod.path

local function load_module(name)
  return assert(load(
    NFS.read(mod_path .. 'src/' .. name .. '.lua'),
    ('=[SMODS %s "src/%s.lua"]'):format(mod.id, name)
  ))()
end

SMODS.current_mod.description_loc_vars = function()
  return {
    background_colour = G.C.CLEAR,
    text_colour = G.C.WHITE,
  }
end

local bridge_commands = load_module('commands')
local socket_module = jit.os == 'Windows' and 'socket_server_windows' or 'socket_server'
local actions = load_module('actions')
actions.list_game_entities = load_module('entities')
bridge_commands.init({
  actions = actions,
  state = load_module('state'),
  jsonrpc = load_module('jsonrpc'),
  socket = load_module(socket_module),
  socket_codec = load_module('socket_codec'),
})

local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end

  local commands_ok, commands_err = pcall(bridge_commands.update)
  if not commands_ok then
    sendDebugMessage('MCP: Command bridge update failed: ' .. tostring(commands_err), mod.id)
  end
end

local _original_love_quit = love.quit

function love.quit()
  bridge_commands.shutdown()
  if _original_love_quit then
    return _original_love_quit()
  end
end

sendDebugMessage('Loaded Balatro MCP Dev Mod (bridge active)', mod.id)
