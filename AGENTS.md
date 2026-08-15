# AGENTS.md

## Project

Balatro Agent has two runtime components:

- `mcp/`: a Bun TypeScript stdio server using the MCP 2026-07-28 SDK
- `mod/`: a Lua Steamodded mod running inside Balatro

They exchange newline-delimited JSON-RPC 2.0 over a local byte stream:

- macOS/Linux: `/tmp/balatro-mcp.sock`
- Windows: `\\.\pipe\balatro-mcp`

`BALATRO_BRIDGE_SOCKET` overrides either endpoint and must match in both processes.

## Setup and validation

```sh
cd mcp
bun install
bun run typecheck
bun run build
```

Validate every Lua file with `luac -p`. On macOS/Linux:

```sh
find ../mod -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

Type checking is mandatory before completion. Build validation is mandatory when MCP source or dependencies change. Gameplay changes also require manual testing with Balatro, Lovely, and SMODS running; restart Balatro after reinstalling the mod.

The root `Makefile` is a macOS convenience workflow:

```sh
make doctor
make install-mods
make run
```

Windows users install the mod under `%AppData%\Balatro\Mods\balatro_mcp` and start Balatro through Steam after Lovely/SMODS are installed.

## MCP server layout

```text
mcp/src/
├── index.ts                 server composition and stdio lifecycle
├── response.ts              MCP result rendering and bridge error mapping
├── bridge/
│   ├── protocol.ts          internal JSON-RPC framing
│   └── socket-client.ts     cross-platform IPC client
├── tools/
│   ├── actions.ts           mutating game tools
│   ├── entities.ts          runtime entities and wiki lookup
│   └── inspectGameState.ts  state and live-card inspection
├── prompts/handbook.ts      handbook prompt registration
└── resources/wiki.ts        static index and live Wiki resources
```

Run directly from TypeScript with `bun run start`; bundling is optional and embeds text imports such as the handbook prompt.

### TypeScript conventions

- Strict TypeScript; no suppressions or `any`.
- Local imports include `.js` extensions.
- Use `import type` for type-only imports.
- Import subdirectory APIs through their `index.ts` when a barrel exists.
- Prompt text uses `with { type: "text" }`; do not inline long prompt content.
- Exported functions use declarations; callbacks use arrows.
- Use `!== undefined` when absence differs from a falsy value.
- Format with the repository's `oxfmt` dependency.

### MCP 2026-07-28 conventions

- Import server APIs from `@modelcontextprotocol/server` and stdio from `@modelcontextprotocol/server/stdio`.
- Use `serveStdio`; do not recreate the removed initialize/session flow.
- Register a title, strict Zod input schema, output schema where applicable, and accurate annotations for every tool.
- Read-only tools use `readOnlyHint: true`; state-changing game actions use `destructiveHint: true`; only repeat-safe operations use `idempotentHint: true`.
- External wiki access uses `openWorldHint: true`; local game operations use `false`.
- Keep machine-readable data in `structuredContent` and useful Markdown in text content.
- Live-play guidance lives in the `balatro_play_handbook` prompt. Use `balatro_wiki_search` and `balatro://wiki/<Title>` to verify rules; do not duplicate a static rules resource.
- Cache discovery/list responses and immutable resources with cache hints.

Reference: [MCP 2026-07-28 documentation](https://modelcontextprotocol.io/docs/2026-07-28) and [TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/).

## Lua mod layout

```text
mod/
├── main.lua
└── src/
    ├── actions.lua                authoritative phase/target checks and game mutations
    ├── commands.lua               command dispatch and deferred scoring responses
    ├── entities.lua               runtime prototype inspection
    ├── jsonrpc.lua                JSON-RPC validation and error mapping
    ├── socket_codec.lua           shared NDJSON codec
    ├── socket_server.lua          macOS/Linux AF_UNIX server
    ├── socket_server_windows.lua  Windows named-pipe server
    └── state.lua                  state snapshots
```

The platform transport is selected before its FFI declarations load. Keep protocol behavior identical across the POSIX and Windows transports.

Validate input shape once in the MCP Zod schema. Lua should validate facts only the game can authoritatively know: current phase, live card identity, funds, slots, stickers, and callback readiness. `commands.lua` owns the single action `pcall`; do not add nested catch-and-rethrow layers.

Comments should explain only non-obvious runtime constraints. Delete banners, narration, migration history, and comments that merely restate the next line.

## Behavioral contracts

- Inspect state before actions; Lua remains authoritative if state changes between calls.
- `card_id` identifies a live card. `entity_id` identifies a prototype.
- Tool errors use stable codes such as `GAME_NOT_RUNNING`, `INSTANCE_BUSY`, `WRONG_PHASE`, `INVALID_TARGET`, and `INSUFFICIENT_FUNDS`.
- The bridge accepts one client. Extra clients receive or infer `INSTANCE_BUSY` and retry at a slower interval.
- Writes must be byte-correct and serialized; NDJSON frames end with `\n`.
- `play_hand` responds after scoring settles, or with `timed_out: true` and the latest observed score.

## Windows compatibility

Do not introduce POSIX-only endpoints, paths, shell assumptions, or FFI into shared runtime code. Changes to framing, reconnect behavior, environment overrides, or module loading must be checked against both transport implementations. Windows runtime support may be documented as implemented but not locally verified unless it was actually exercised on Windows.
