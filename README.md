<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh.md)

<!-- README-I18N:END -->

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro Agent combines a Bun MCP server with a Steamodded/Lovely mod. Agents receive structured game state and invoke typed actions without screenshots or screen scraping.

The runtime bridge supports macOS and Linux through Unix sockets and Windows through a named pipe. Development has only been exercised locally on macOS Apple Silicon; the root `make` workflow remains macOS-specific.

## Architecture

```text
MCP client ── stdio ──> Bun server ── JSON-RPC 2.0 / NDJSON ──> Balatro mod
                              Unix socket (macOS/Linux)
                              named pipe  (Windows)
```

The bridge endpoint defaults to `/tmp/balatro-mcp.sock` on macOS/Linux and `\\.\pipe\balatro-mcp` on Windows. Set `BALATRO_BRIDGE_SOCKET` for both processes to override it.

## Requirements

- Balatro from Steam
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
- [Bun](https://bun.sh) 1.3.14 or newer
- `luac` for Lua syntax validation

## Setup

Install the server dependencies and validate the source:

```sh
cd mcp
bun install
bun run typecheck
bun run build
```

Install `mods/balatro_mcp` under the Balatro `Mods` directory:

- macOS development checkout: `make install-mods`
- Windows: copy it to `%AppData%\Balatro\Mods\balatro_mcp`

Start Balatro with the mod enabled, then configure an MCP client to run the TypeScript source directly:

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

Bundling is optional; `bun run build` writes `mcp/dist/index.js`.

## MCP surface

The server exposes 22 tools:

| Area | Tools |
| --- | --- |
| State | `balatro_inspect_game_state`, `balatro_inspect_card_instance` |
| Blinds | `balatro_select_blind`, `balatro_skip_blind` |
| Hand | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand` |
| Shop | `balatro_buy_card`, `balatro_buy_consumable`, `balatro_buy_voucher`, `balatro_buy_booster`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out` |
| Cards | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers` |
| Boosters | `balatro_select_booster_card`, `balatro_skip_booster` |
| Knowledge | `balatro_list_game_entities`, `balatro_read_wiki` |

Static rules are exposed once through the `balatro://rules/global` resource and included in the `balatro_strategy_context` prompt. Inspect live state before every action.

## Development

```sh
cd mcp
bun run typecheck
bun run build
find ../mods/balatro_mcp -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

After changing the mod, reinstall it and restart Balatro before manual MCP testing.

## References

- [Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28)
- [Bun documentation](https://bun.sh/docs)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
