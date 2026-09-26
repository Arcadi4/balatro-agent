# AGENTS.md

## Project

Two runtime components:

- `mcp/`: Bun TypeScript stdio MCP server
- `mod/`: Lua Steamodded mod running inside Balatro

IPC is newline-delimited JSON-RPC 2.0 over a per-instance endpoint:
`/tmp/balatro-mcp-<instance>.sock` (macOS/Linux) or `\\.\pipe\balatro-mcp-<instance>`
(Windows). Each launch publishes a discovery record (`/tmp/balatro-mcp-<instance>`,
`%TEMP%\balatro-mcp-<instance>` on Windows) that clients scan, and each connection carries an
instance id, so one process can drive several Balatro instances. `BALATRO_BRIDGE_SOCKET`
overrides the endpoint prefix and `BALATRO_BRIDGE_REGISTRY` the record prefix; both processes
must use the same overrides or discovery finds nothing.

Live state ships as resources: `balatro://instances`,
`balatro://instances/{instance_id}/{turn,hand,jokers,consumables,deck,shop,booster,run,ante}`,
and the unscoped aliases `balatro://turn` … `balatro://ante`, which resolve to the selected
instance. `connect` selects an instance; action tools take an optional `instance_id` and
otherwise use the selected one.

## Toolchain

### Bun

`mcp/` is Bun-first. Use Bun 1.4.2 or later for dependency installation, development,
formatting, typechecking, tests, and builds; the script names live in `mcp/package.json`.
Install with `bun install --frozen-lockfile`.

Do not introduce a Node-based development command or require Node in the MCP build job.
`bunfig.toml` selects Bun for package executables, and Bun's built-in Node compatibility APIs
cover the remaining `node:` imports. Use Bun APIs when a suitable native API exists. The
GitHub Actions build job uses only Bun; Node/npm appear solely in the publishing job, and end
users running `npx` receive a native binary. `bun run release:setup` is the one interactive npm
step; `mcp/README.md` owns the release flow.

### Make

`make doctor` checks the local Balatro, Lovely, and SMODS paths, `make install-mods` syncs
`mod/` into the Balatro `Mods` directory, and `make run` syncs and then launches Balatro with
Lovely (`ARGS="..."` passes game arguments). `BALATRO_DIR` and `BALATRO_SAVE` override the
macOS defaults.

## Code conventions

Static reference data lives in `mcp/data/`; the bundle embeds those text imports.

### TypeScript conventions

- Strict TypeScript; no suppressions or `any`.
- Local imports use `.js` extensions; `import type` for type-only imports.
- Barrel imports via `index.ts`; prose (`.md`, `.txt`) via `with { type: "text" }`.
- Exported functions use declarations; callbacks use arrows.
- Use `!== undefined` when absence differs from falsy. Format with `oxfmt`.

### MCP 2026-07-28 conventions

- Import from `@modelcontextprotocol/server`; stdio from `.../stdio`. Use `serveStdio`.
- Every tool: title, strict Zod input schema, output schema where applicable, accurate annotations.
- Hints: `readOnlyHint` for reads; `destructiveHint: true` only where a tool spends, discards,
  or irreversibly replaces game state — not for every state change, so selection, sorting, and
  reordering stay `false`; `idempotentHint` only when repeat-safe; `openWorldHint: true` for
  wiki, `false` for local game ops.
- Machine-readable data in `structuredContent`; useful Markdown in text content.
- Live-play guidance in `balatro_play_handbook`. Verify rules via wiki; do not duplicate static rule resources. Cache discovery/list and immutable resources.

[MCP 2026-07-28 docs](https://modelcontextprotocol.io/docs/2026-07-28) · [TS SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)

## Lua mod

Platform transport is selected before FFI declarations load; keep protocol behavior identical across POSIX and Windows.

Validate input shape once in the MCP Zod schema. Lua validates only game-authoritative facts: current phase, live card identity, funds, slots, stickers, callback readiness. `commands.lua` owns the single action `pcall`; no nested catch-and-rethrow. Comments explain non-obvious runtime constraints only; delete banners, narration, and restatements.

## Testing

Use disposable smoke tests for verification. Do not commit new test suites unless requested.

## Validation ownership

The agent that owns a change set runs project-wide validation once, after every concurrent
edit has landed: `bun run typecheck`, `bun run format`, `bun test`, `bun run build`, and the
Lua parse over `mod/`. Siblings and subagents must not run these mid-flight, because
half-finished edits elsewhere turn into phantom failures. Verify a change with a scoped
command or a targeted repro that exercises the path you touched.

## Windows compatibility

No POSIX-only endpoints, paths, shell assumptions, or FFI in shared runtime code. Framing, reconnect, env overrides, and module loading changes must be validated against both transports.
