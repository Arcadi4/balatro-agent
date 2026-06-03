local mod = SMODS.current_mod
local mod_path = mod.path

SMODS.current_mod.description_loc_vars = function()
  return {
    background_colour = G.C.CLEAR,
    text_colour = G.C.WHITE,
  }
end

local bridge_commands = assert(load(NFS.read(mod_path .. 'src/commands.lua'),
  ('=[SMODS %s "src/commands.lua"]'):format(mod.id)))()

local bridge_actions = assert(load(NFS.read(mod_path .. 'src/actions.lua'),
  ('=[SMODS %s "src/actions.lua"]'):format(mod.id)))()

bridge_actions.register_all(bridge_commands)

local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end

  local commands_ok, commands_err = pcall(bridge_commands.update, dt)
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

sendDebugMessage('Loaded Balatro MCP Dev Mod (socket bridge active)', mod.id)
