<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh.md)

<!-- README-I18N:END -->

[![npm](https://img.shields.io/npm/v/balatro-mcp?style=flat-square)](https://www.npmjs.com/package/balatro-mcp) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-3c873a?style=flat-square)](https://nodejs.org) [![Bun](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?style=flat-square&logo=bun)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Let an AI agent play Balatro. Balatro Agent connects any MCP-compatible AI client to a running game. The agent can read live state, pick blinds, play and discard hands, buy jokers, and perform any action available to a human player. It needs no screen capture or vision model; everything works through text tool calls.

<https://github.com/user-attachments/assets/bcb40bd1-a9f8-491c-9a98-6f1a11c90fab>

> [!IMPORTANT]
> Balatro v1.1 is coming. I will try to provide support asap when its released. Any release after that will not guarantee compatibility with the v1.0 game.

## Requirements

- [Balatro](https://store.steampowered.com/app/2379780/Balatro/) on Steam
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded (SMODS)](https://github.com/Steamodded/smods)
- [Node.js](https://nodejs.org) 20 or later for npx (it launches a native MCP binary; Bun, cloning, and building are not required). Native archives from GitHub Releases also run without Node.

## Install

### 1. Install Lovely and SMODS

Follow the [SMODS installation guide](https://github.com/Steamodded/smods/wiki) for your platform. This step is the same for every Balatro mod.

### 2. Install the Balatro Agent mod

Download and unpack the mod into Balatro's `Mods` directory:

- [Nexus Mods](https://www.nexusmods.com/balatro/mods/927): manual download, or use "Mod Manager Download" together with the [community Vortex extension](https://www.nexusmods.com/site/mods/1315), which also installs Lovely and Steamodded for you.
- [GitHub Releases](https://github.com/Arcadi4/balatro-agent/releases/latest): grab `balatro-agent-vX.Y.Z.zip` from the latest release.

| Platform | Mods directory |
| --- | --- |
| macOS | `~/Library/Application Support/Balatro/Mods/` |
| Windows | `%AppData%\Balatro\Mods\` |
| Linux (native) | `~/.local/share/love/Balatro/Mods/` |
| Linux (Proton) | `~/.steam/steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro/Mods/` |

> [!TIP]
> On macOS you can clone and run `make install-mods` from the repository root instead of copying by hand.

The result should look like `.../Balatro/Mods/balatro-agent/main.lua`.

### 3. Connect your Agent

Add the server to your MCP client configuration (Claude Code, Cursor, etc.), check the corresponding tutorials/docs. The config file might look like:

```json
{
  "mcpServers": {
    "balatro": {
      "command": "npx",
      "args": ["-y","balatro-mcp"]
    }
  }
}
```

The whole command on one line:

```bash
npx -y balatro-mcp
```

## Start Playing

1. Start Balatro with the mod enabled.
2. Start your MCP client.
3. Ask the agent to play, for example:

   > Start a new run with the Red Deck and play through Ante 1.

## Features

- Provides basic tools to select or skip blinds, play and discard hands, sort and select cards
- Interact with the shop to buy jokers, consumables, vouchers and boosters, reroll, cash out
- Use and sell cards, reorder jokers for optimal trigger order
- Start, continue, and restart runs with any deck, stake, or challenges
- Provides a play handbook and reference data, plus live lookup of cards, blinds, and mechanics from the Balatro Wiki

> [!IMPORTANT]
> Live game state and the wiki are exposed as [MCP resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources). If your agent client does not support resources properly, the agent may be unable to read the current game state or wiki pages.
