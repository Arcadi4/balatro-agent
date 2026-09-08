# AGENTS.md

## Project

Two runtime components:

- `mcp/`: Bun TypeScript stdio MCP server
- `mod/`: Lua Steamodded mod running inside Balatro

IPC: newline-delimited JSON-RPC 2.0 over `/tmp/balatro-mcp.sock` (macOS/Linux) or `\\.\pipe\balatro-mcp` (Windows). `BALATRO_BRIDGE_SOCKET` overrides either; must match both processes.

## Setup and validation

```sh
(cd mcp && bun install && bun run typecheck && bun run build)
find mod -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

Typecheck and Lua validation are mandatory before completion. Gameplay changes require manual testing with Balatro + Lovely + SMODS; restart Balatro after reinstalling the mod.

- macOS: `make doctor && make install-mods && make run`.
- Windows: install mod under `%AppData%\Balatro\Mods\balatro-agent`, launch via Steam.

## MCP server layout

```text
mcp/src/
├── index.ts          server + stdio lifecycle
├── response.ts       MCP result rendering, bridge error mapping
├── gate.ts           availability switch for the live-game tool/resource surface
├── wiki.ts           Wiki HTML→Markdown, MediaWiki API
├── postgame.ts       post-game analysis storage
├── text-imports.d.ts ambient types for .txt/.md imports
├── bridge/           JSON-RPC framing + connect handshake + IPC client
├── tools/            connect.ts, actions.ts, entities.ts, postgame.ts, descriptions/
├── prompts/          handbook.ts + handbook.md
└── resources/        live.ts, wiki.ts, postgame.ts, cardModifiers.ts, decks.ts, stakes.ts, challenges.ts
```

Static reference data: `mcp/data/`. Run with `bun run start`; bundling embeds text imports.

### TypeScript conventions

- Strict TypeScript; no suppressions or `any`.
- Local imports use `.js` extensions; `import type` for type-only imports.
- Barrel imports via `index.ts`; prose (`.md`, `.txt`) via `with { type: "text" }`.
- Exported functions use declarations; callbacks use arrows.
- Use `!== undefined` when absence differs from falsy. Format with `oxfmt`.

### MCP 2026-07-28 conventions

- Import from `@modelcontextprotocol/server`; stdio from `.../stdio`. Use `serveStdio`.
- Every tool: title, strict Zod input schema, output schema where applicable, accurate annotations.
- Hints: `readOnlyHint` for reads; `destructiveHint` for state-changing actions; `idempotentHint` only when repeat-safe; `openWorldHint: true` for wiki, `false` for local game ops.
- Machine-readable data in `structuredContent`; useful Markdown in text content.
- Live-play guidance in `balatro_play_handbook`. Verify rules via wiki; do not duplicate static rule resources. Cache discovery/list and immutable resources.

[MCP 2026-07-28 docs](https://modelcontextprotocol.io/docs/2026-07-28) · [TS SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)

## Lua mod layout

```text
mod/src/
├── actions.lua                phase/target checks and game mutations
├── commands.lua               command dispatch and deferred scoring
├── jsonrpc.lua                JSON-RPC validation and error mapping
├── socket_codec.lua           shared NDJSON codec
├── socket_server.lua          macOS/Linux AF_UNIX server
├── socket_server_windows.lua  Windows named-pipe server
└── state.lua                  state snapshots
```

Platform transport is selected before FFI declarations load; keep protocol behavior identical across POSIX and Windows.

Validate input shape once in the MCP Zod schema. Lua validates only game-authoritative facts: current phase, live card identity, funds, slots, stickers, callback readiness. `commands.lua` owns the single action `pcall`; no nested catch-and-rethrow. Comments explain non-obvious runtime constraints only; delete banners, narration, and restatements.

## Testing

You may create minimal PoC tests and dispose them once the targeted module passes verification. No persisted and serious tests unless explicitly asked.

## Windows compatibility

No POSIX-only endpoints, paths, shell assumptions, or FFI in shared runtime code. Framing, reconnect, env overrides, and module loading changes must be validated against both transports.
