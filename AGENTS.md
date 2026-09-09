# AGENTS.md

## Project

Two runtime components:

- `mcp/`: Bun TypeScript stdio MCP server
- `mod/`: Lua Steamodded mod running inside Balatro

IPC: newline-delimited JSON-RPC 2.0 over `/tmp/balatro-mcp.sock` (macOS/Linux) or `\\.\pipe\balatro-mcp` (Windows). `BALATRO_BRIDGE_SOCKET` overrides either; must match both processes.

## Toolchain

### Bun

The MCP package is Bun-first. Use Bun 1.4.2 or later from `mcp/` for dependency
installation, development, formatting, typechecking, tests, and builds:

```sh
cd mcp
bun install --frozen-lockfile
bun run dev             # watch mode
bun run typecheck
bun run format
bun test
bun run build
```

Do not introduce a Node-based development command or require Node in the MCP build
job. `bunfig.toml` selects Bun for package executables, and Bun's built-in Node
compatibility APIs cover the remaining `node:` imports. Use Bun APIs when a suitable
native API exists.

Release builds use Bun:

```sh
bun run build:release   # build native binaries and npm packages
```

Run `bun run release:setup` once to configure npm packages. It may use native npm for
the interactive trust flow. The GitHub Actions build job uses only Bun; Node/npm are
used only by the publishing job. End users running `npx` receive a native binary.

### Make

```sh
make doctor        # check local Balatro, Lovely, and SMODS paths
make install-mods  # sync mod into the Balatro Mods directory
make run           # sync mod, then launch Balatro with Lovely (pass ARGS="...")
```

## MCP server layout

```text
mcp/src/
├── index.ts          server + stdio lifecycle
├── response.ts       MCP result rendering, bridge error mapping
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
