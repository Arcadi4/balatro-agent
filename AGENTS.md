# AGENTS

## Project

- `mcp/`: Bun TypeScript stdio MCP server
- `mod/`: Lua Steamodded mod running inside Balatro

IPC is newline-delimited JSON-RPC 2.0 over a per-instance endpoint: `/tmp/balatro-mcp-<instance>.sock` (macOS/Linux) or `\\.\pipe\balatro-mcp-<instance>` (Windows). Each launch publishes a discovery record (`/tmp/balatro-mcp-<instance>`, `%TEMP%\balatro-mcp-<instance>` on Windows) that clients scan, and each connection carries an instance id, so one process can drive several Balatro instances. `BALATRO_BRIDGE_SOCKET` overrides the endpoint prefix and `BALATRO_BRIDGE_REGISTRY` the record prefix; both processes must use the same overrides or discovery finds nothing.

Live state ships as resources: `balatro://instances`, `balatro://instances/{instance_index}/{turn,hand,jokers,consumables,deck,shop,booster,run,ante}`, and the unscoped aliases `balatro://turn` … `balatro://ante`. Public instance indices are 0-based, oldest-first, and recomputed on discovery; per-launch IDs stay internal to IPC. Tools take an optional `instance_index`; omitting it or reading an unscoped alias requires exactly one live discovered instance. Multiple instances produce a recoverable selection error before acting. Actions and live reads connect on demand; `connect` establishes IPC without selecting a default. Resolve once per request and pin the private identity through all IPC work and successor reads. Registry observation emits resource-list change notifications, including index remapping.

## Toolchain

### Bun

No Node-based development command and no Node in the MCP build job: `bunfig.toml` selects Bun for package executables, and Bun's built-in Node compatibility API covers the remaining `node:` imports. The GitHub Actions build job uses only Bun; Node/npm appear solely in the publishing job, and `npx` users receive a native binary. `bun run release:setup` is the one interactive npm step; `mcp/README.md` owns the release flow.

### Make

`make doctor` checks the local Balatro, Lovely, and SMODS paths, `make install-mods` syncs `mod/` into the Balatro `Mods` directory, and `make run` syncs and then launches Balatro with Lovely (`ARGS="..."` passes game arguments). `BALATRO_DIR` and `BALATRO_SAVE` override the macOS defaults.

### TypeScript conventions

- Strict TypeScript; no suppressions or `any`.
- Local imports use `.js` extensions; `import type` for type-only imports.
- Barrel imports via `index.ts`; prose (`.md`, `.txt`) via `with { type: "text" }`.
- Exported functions use declarations; callbacks use arrows.
- Use `!== undefined` when absence differs from falsy. Format with `oxfmt`.

### MCP 2026-07-28 conventions

- Import from `@modelcontextprotocol/server`; stdio from `.../stdio`. Use `serveStdio`.
- Every tool: title, strict Zod input schema, output schema where applicable, accurate annotations.
- Hints: `readOnlyHint` for reads; `destructiveHint: true` only where a tool spends, discards, or irreversibly replaces game state — not for every state change, so selection, sorting, and reordering stay `false`; `idempotentHint` only when repeat-safe; `openWorldHint: true` for wiki, `false` for local game ops.
- Machine-readable data in `structuredContent`; useful Markdown in text content.
- Live-play guidance in `balatro_play_handbook`. Verify rules via wiki; do not duplicate static rule resources. Cache discovery/list and immutable resources.

## Lua mod

Platform transport is selected before FFI declarations load; keep protocol behavior identical across POSIX and Windows.

Validate input shape once in the MCP Zod schema. Lua validates only game-authoritative facts: current phase, live card identity, funds, slots, stickers, callback readiness. `commands.lua` owns the single action `pcall`; no nested catch-and-rethrow.

## Testing

Use disposable smoke tests for verification. Do not write persistent tests while adding features/fixes.

## Windows compatibility

No POSIX-only endpoints, paths, shell assumptions, or FFI in shared runtime code. Framing, reconnect, env overrides, and module loading changes must be validated against both transports.

## Code style

Before implementing a new abstraction, ask: "does SMODS or the game already do this for me?" Never build systems outside the game; build around the game/SMODS for behavior alignment.

Check the game wiki for domain knowledge. For complicated fixes and features, read SMODS's source and the game's source dump.

On bugs involving game behavior or information, the fix is usually removing logic, not adding more.

## Comment style

- Comment when the reason for the code is non-obvious.
- Comment when something was deliberately not implemented or fixed, stating the exact decision or technical constraint that blocks it.
- Do not restate what the code does; if that is unclear, refactor instead.
- Do not repeat docs across call sites. Keep one source per doc statement.
- Do not record the history of the code's shape. That is `git blame`'s job.
