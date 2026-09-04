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

local DEFAULT_HTTP_PORT = '52745'

local function normalize_http_port()
  local value = mod.config.http_port
  if type(value) == 'number' then
    value = tostring(value)
    mod.config.http_port = value
  end
  if type(value) ~= 'string' or not value:match('^%d+$') then
    mod.config.http_port = DEFAULT_HTTP_PORT
    return tonumber(DEFAULT_HTTP_PORT)
  end
  local port = tonumber(value)
  if not port or port < 1 or port > 65535 then
    mod.config.http_port = DEFAULT_HTTP_PORT
    return tonumber(DEFAULT_HTTP_PORT)
  end
  mod.config.http_port = tostring(port)
  return port
end

local http_port = normalize_http_port()

local bridge_commands = load_module('commands')
local socket_module = jit.os == 'Windows' and 'socket_server_windows' or 'socket_server'
local process_module = jit.os == 'Windows' and 'http_process_windows' or 'http_process'
local sidecar = load_module('http_sidecar')
local card_ids = load_module('card_ids')
local actions = load_module('actions')
local state = load_module('state')
actions.configure(card_ids)
state.configure(card_ids)
bridge_commands.init({
  actions = actions,
  state = state,
  jsonrpc = load_module('jsonrpc'),
  socket = load_module(socket_module),
  socket_codec = load_module('socket_codec'),
})

sidecar.init(load_module(process_module))
if mod.config.http_enabled then sidecar.start(mod.version, mod.config.resource_tools, http_port) end

mod.config_tab = function()
  return {
    n = G.UIT.ROOT,
    config = { align = 'cm', padding = 0.2, colour = G.C.BLACK },
    nodes = {
      create_toggle({
        label = 'Enable local HTTP MCP server (restart Balatro)',
        ref_table = mod.config,
        ref_value = 'http_enabled',
      }),
      {
        n = G.UIT.R,
        config = { align = 'cm', padding = 0.05 },
        nodes = {
          { n = G.UIT.T, config = { text = 'MCP port', scale = 0.35, colour = G.C.UI.TEXT_LIGHT } },
          create_text_input({
            max_length = 5,
            extended_corpus = true,
            prompt_text = '1-65535',
            ref_table = mod.config,
            ref_value = 'http_port',
            callback = normalize_http_port,
          }),
        },
      },
      create_toggle({
        label = 'Expose MCP resources as tools (restart Balatro)',
        ref_table = mod.config,
        ref_value = 'resource_tools',
      }),
    },
  }
end


local _original_love_update = love.update

function love.update(dt)
  if _original_love_update then
    _original_love_update(dt)
  end
  card_ids.update()

  local commands_ok, commands_err = pcall(bridge_commands.update)
  if not commands_ok then
    sendDebugMessage('MCP: Command bridge update failed: ' .. tostring(commands_err), mod.id)
  end
end

local _original_love_quit = love.quit

function love.quit()
  sidecar.shutdown()
  bridge_commands.shutdown()
  if _original_love_quit then
    return _original_love_quit()
  end
end

sendDebugMessage('Loaded Balatro MCP Dev Mod (bridge active)', mod.id)
