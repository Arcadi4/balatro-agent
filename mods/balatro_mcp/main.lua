local mod = SMODS.current_mod
local mod_path = mod.path

SMODS.current_mod.description_loc_vars = function()
  return {
    background_colour = G.C.CLEAR,
    text_colour = G.C.WHITE,
  }
end

local bridge_state = assert(load(NFS.read(mod_path .. 'src/state.lua'),
  ('=[SMODS %s "src/state.lua"]'):format(mod.id)))()

local bridge_commands = assert(load(NFS.read(mod_path .. 'src/commands.lua'),
  ('=[SMODS %s "src/commands.lua"]'):format(mod.id)))()

local bridge_actions = assert(load(NFS.read(mod_path .. 'src/actions.lua'),
  ('=[SMODS %s "src/actions.lua"]'):format(mod.id)))()

-- Wire actions into commands dispatcher
bridge_actions.register_all(bridge_commands)

local BRIDGE_DIR = love.filesystem.getSaveDirectory() .. '/Mods/balatro_mcp/bridge'

bridge_commands.set_state_writer(function()
  bridge_state.write(BRIDGE_DIR)
  local seq = bridge_state.get_seq()
  bridge_commands.set_state_seq(seq)
  return seq
end)

local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end

  local state_ok, state_err = pcall(bridge_state.update, BRIDGE_DIR)
  if not state_ok then
    sendDebugMessage('MCP: State bridge update failed: ' .. tostring(state_err), mod.id)
  elseif state_err then
    bridge_commands.set_state_seq(bridge_state.get_seq())
  end

  local commands_ok, commands_err = pcall(bridge_commands.update, dt)
  if not commands_ok then
    sendDebugMessage('MCP: Command bridge update failed: ' .. tostring(commands_err), mod.id)
  end
end

sendDebugMessage('Loaded Balatro MCP Dev Mod (bridge active)', mod.id)
