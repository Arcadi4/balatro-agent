

<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh.md)

<!-- README-I18N:END -->

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a?style=flat-square)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-Server-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro Agent pairs a TypeScript MCP server with a Steamodded/Lovely Balatro mod so agents can inspect live game state and interact with Balatro through a fully textual interface. No vision model or screen scraping is required.

> [!WARNING]
> This project is currently configured and tested for macOS Apple Silicon. Universal setup support is planned for a future release.

## What It Provides

- **Live game observations** through `balatro_inspect_game_state`, including phase, hand, jokers, shop, blind, deck summary, legal actions, and rules metadata.
- **Typed game actions** for blinds, hand selection, play/discard, buying, boosters, shop flow, consumables, selling, and Joker reordering.
- **Text-first agent control** so models can reason over structured state instead of relying on screenshots.
- **Game knowledge surfaces** including a rules resource, strategy prompt, and entity references.

## Architecture

```text
Agent / MCP client
    E.g. Claude Code, Codex, or even WorkBuddy
          |
          | stdio MCP
          v
mcp/dist/index.js
    will release a npm package
    later for the ease of installation
          |
          | JSON commands, responses, state snapshots
          v
~/Library/Application Support/Balatro/Mods/balatro_mcp/
    communicates via Unix socket at /tmp/balatro-mcp.sock
    using JSON-RPC 2.0 framed messages.
          |
          | love.update hook
          v
Balatro + Lovely + SMODS + balatro_mcp mod
```

## Requirements

- Balatro installed through Steam.
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector).
- [Steamodded / SMODS](https://github.com/Steamodded/smods).
- Node.js 18 or newer.
- pnpm.
- Lua tooling with `luac` available for syntax checks.

## Quick Start

Use `make` from the repository root for the local development workflow:

| Command             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `make doctor`       | Check local Balatro, Lovely, and SMODS paths.                     |
| `make install-mods` | Sync repo mods into `~/Library/Application Support/Balatro/Mods`. |
| `make run`          | Sync repo mods, then launch Balatro with Lovely.                  |

Override local paths when needed, for example:

```sh
make doctor BALATRO_DIR="/path/to/Balatro" BALATRO_SAVE="/path/to/Balatro/save"
```

Build the MCP server from `mcp/`, then configure your MCP client to launch `mcp/dist/index.js`.

## Using the MCP Server

The server exposes tools with the `balatro_` prefix, including:

| Area      | Tools                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| State     | `balatro_inspect_game_state`                                                                                        |
| Blinds    | `balatro_select_blind`, `balatro_skip_blind`                                                                        |
| Hand play | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand`                       |
| Shop      | `balatro_buy_card`, `balatro_buy_and_use_card`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out`     |
| Cards     | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers`                                             |
| Boosters  | `balatro_open_booster`, `balatro_select_booster_card`, `balatro_skip_booster`                                       |
| Knowledge | `balatro_get_game_rules`, `balatro_list_game_entities`, `balatro_read_wiki`, `balatro_inspect_card_instance` |

It also registers:

- `balatro://rules/global` as a static rules resource.
- `balatro_strategy_context` as a strategy prompt for agents.

Gameplay agents should call `balatro_get_game_rules` before starting or resuming a run, then call `balatro_inspect_game_state` before each action.

## Validation

When changing the MCP server or companion mod, run the relevant TypeScript and Lua checks for your checkout. After changing the Balatro mod, run `make install-mods`, reload Balatro, and verify the behavior through the MCP tools rather than only reading the code.

## Troubleshooting

### MCP tools report `GAME_NOT_RUNNING`

Make sure Balatro is running with the companion mod loaded, then confirm the MCP client is launching the built server successfully.

### Balatro does not reflect a mod change

Reload or restart Balatro after updating the installed companion mod. Lua files are loaded by the game runtime, not by the MCP server process.

### The MCP server cannot start

Build the MCP server before launching it. If your client launches a stale build, rebuild and restart the MCP session.

## References

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
- [SMODS wiki](https://github.com/Steamodded/smods/wiki)
