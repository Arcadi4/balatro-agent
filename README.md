<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh.md)

<!-- README-I18N:END -->

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro Agent lets you connect an MCP-compatible AI agent to Balatro. The agent reads the live game state and plays the game for you. It can select blinds, play and discard hands, buy and use cards, reroll the shop, and arrange jokers. It works from textual interfaces, no model vision needed at all.

## How it works

The project contains two components:

- A Bun MCP server in `mcp/`. Your MCP client launches it and talks to it over stdio.
- A Steamodded mod in `mods/balatro_mcp/`. It runs inside Balatro and executes game actions.

The server and the mod communicate over newline-delimited JSON-RPC 2.0:

```text
MCP client ── stdio ──> Bun server ── JSON-RPC 2.0 / NDJSON ──> Balatro mod
                              Unix socket (macOS/Linux)
                              named pipe  (Windows)
```

## Prerequisites

- Balatro from Steam
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded (SMODS)](https://github.com/Steamodded/smods)
- [Bun](https://bun.sh) 1.3.14 or later

## Get started

1. Install Lovely Injector and Steamodded.
2. Install the mod by copying `mods/balatro_mcp` to the Balatro `Mods` directory.
   - On macOS, run `make install-mods` from the repository root.
   - On Windows, copy the directory to `%AppData%\Balatro\Mods\balatro_mcp`.
3. Install the server dependencies and validate the source:

   ```sh
   cd mcp
   bun install
   bun run typecheck
   ```

4. Add the server to your MCP client configuration:

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

5. Start Balatro with the mod enabled.
6. Start your MCP client and ask the agent to play. For example: "Inspect the game state and play the next blind."

## Change the bridge endpoint

The server and the mod find each other at `/tmp/balatro-mcp.sock` on macOS and Linux, and `\\.\pipe\balatro-mcp` on Windows. To use a different endpoint, set `BALATRO_BRIDGE_SOCKET` to the same value in both processes.

## What the agent can do

The agent has 25 tools available.

| Area | Tools |
| --- | --- |
| Inspect the game | `balatro_inspect_game_state`, `balatro_inspect_card_instance` |
| Blinds | `balatro_select_blind`, `balatro_skip_blind` |
| Hand | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand` |
| Shop | `balatro_buy_card`, `balatro_buy_consumable`, `balatro_buy_voucher`, `balatro_buy_booster`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out` |
| Cards | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers` |
| Boosters | `balatro_select_booster_card`, `balatro_skip_booster` |
| Game control | `balatro_new_game`, `balatro_continue_game`, `balatro_restart` |
| Game knowledge | `balatro_list_game_entities`, `balatro_read_wiki` |

The agent also receives the static rules of Balatro through the `balatro://rules/global` resource and the `balatro_strategy_context` prompt, so it can make decisions without external documentation.

## Troubleshooting

- **The agent cannot reach the game.** Make sure Balatro is running with the mod enabled, then restart your MCP client.
- **You changed the mod.** Reinstall it and restart Balatro. The mod only loads at startup.
- **A second client cannot connect.** The bridge accepts one client at a time. Stop the other client and retry.

## Development

Development is tested on macOS Apple Silicon. The `make` targets work on macOS only. After making changes, validate both sources:

```sh
cd mcp
bun run typecheck
bun run build
find ../mods/balatro_mcp -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

## References

- [Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28)
- [Bun documentation](https://bun.sh/docs)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded (SMODS)](https://github.com/Steamodded/smods)
