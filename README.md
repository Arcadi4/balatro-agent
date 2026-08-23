<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh.md)

<!-- README-I18N:END -->

[![Bun](https://img.shields.io/badge/Bun-1.3.14-f9f1e1?style=flat-square&logo=bun)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Let an AI agent play Balatro for you. Balatro Agent connects any MCP-compatible AI client to a running game: the agent reads the live game state, picks blinds, plays and discards hands, shops for jokers, and manages your run. No screen capture or model vision required, everything works over text.

## Requirements

- [Balatro](https://store.steampowered.com/app/2379780/Balatro/) on Steam
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded (SMODS)](https://github.com/Steamodded/smods)
- [Bun](https://bun.sh) 1.3.14 or later to run the MCP server (will publish a npm package later so this would not be needed)

## Install

### 1. Install Lovely and SMODS

Follow the [SMODS installation guide](https://github.com/Steamodded/smods/wiki) for your platform. This step is the same for every Balatro mod.

### 2. Install the Balatro Agent mod

Copy the `mod` folder from this repository into Balatro's `Mods` directory:

| Platform | Mods directory |
| --- | --- |
| macOS | `~/Library/Application Support/Balatro/Mods/` |
| Windows | `%AppData%\Balatro\Mods\` |
| Linux (native) | `~/.local/share/love/Balatro/Mods/` |
| Linux (Proton) | `~/.steam/steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro/Mods/` |

> [!TIP]
> On macOS you can run `make install-mods` from the repository root instead of copying by hand.

The result should look like `.../Balatro/Mods/balatro-agent/main.lua`.

### 3. Install the server

```sh
cd mcp
bun install
```

### 4. Connect your MCP client

Add the server to your MCP client configuration (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "balatro": {
      "command": "bun",
      "args": ["/absolute/path/to/balatro-mcp/mcp/src/index.ts"]
    }
  }
}
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
- Provides a built-in Balatro rule doc, plus live lookup of every card, blind, and mechanic from the Balatro Wiki

> [!IMPORTANT]
> Wiki was exposed as [MCP resoruces](https://modelcontextprotocol.io/specification/2026-07-28/server/resources). If your agent client does not support resources properly, agents might not have access to wiki pages.
