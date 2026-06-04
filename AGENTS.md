# AGENTS.md

## Project Overview

Balatro Agent is a two-part system that enables AI agents to interact with the Balatro game through a textual interface:

1. **TypeScript MCP server** (`mcp/`) - Runs as a Node.js stdio process, exposes 20+ MCP tools for game interaction
2. **Lua Steamodded mod** (`mods/balatro_mcp/`) - Runs inside Balatro, communicates with the MCP server via Unix socket

The server and mod communicate via a Unix socket at `/tmp/balatro-mcp.sock` using JSON-RPC 2.0 framed messages.

**Tech Stack**: TypeScript, Node.js 18+, Zod, MCP SDK, Lua (SMODS/Lovely)

## Setup Commands

### Prerequisites

- Balatro installed through Steam
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector) installed
- [Steamodded/SMODS](https://github.com/Steamodded/smods) mod installed
- Node.js 18 or newer
- pnpm package manager
- `luac` available for Lua syntax validation

### Installation

```bash
# Install MCP server dependencies
cd mcp && pnpm install

# Verify Balatro/Lovely/SMODS paths
make doctor

# Sync mods from repo to Balatro Mods directory
make install-mods
```

### Path Configuration

Override default paths if needed:

```bash
make doctor BALATRO_DIR="/path/to/Balatro" BALATRO_SAVE="/path/to/Balatro/save"
```

## Development Workflow

### MCP Server Development

```bash
cd mcp

# Build TypeScript to dist/
pnpm build

# Run compiled server (production)
pnpm start

# Run with tsx in watch mode (development)
pnpm dev

# Type-check without emitting files
pnpm typecheck
```

**Entry point**: `mcp/dist/index.js` (stdio MCP server)

### Mod Development (Lua)

```bash
# After editing Lua files in mods/balatro_mcp/src/
make install-mods    # Sync changes to Balatro Mods directory

# Then restart Balatro to load changes
# Lua mods have no hot-reload - full restart required
```

### Combined Workflow

```bash
# Build MCP server + sync mods + launch Balatro
make run

# Pass arguments to Balatro
make run ARGS="--debug"
```

## Testing Instructions

**No automated test framework is configured.** Testing is validation-based:

### 1. Type Checking (MANDATORY before claiming work is done)

```bash
cd mcp && pnpm typecheck
```

This runs `tsc --noEmit -p .` and catches all type errors. Build must pass.

### 2. Build Validation

```bash
cd mcp && pnpm build
```

If build fails, the code is broken. Fix before proceeding.

### 3. Manual QA

For behavior changes, follow the manual QA runbooks:

- `mcp/docs/manual-qa/e2e-smoke.md` - Step-by-step testing of all 20 MCP tools
- `mcp/docs/manual-qa/tool-audit.md` - Tool description/annotation audit checklist

**Requirements**: Balatro must be running with the mod installed. Capture state snapshots in `.sisyphus/evidence/` per runbook convention.

## Code Style

### Formatting

- **Formatter**: `oxfmt` v0.53.0 (uses defaults, no config file)
- No ESLint config exists
- No Prettier config exists

### TypeScript Configuration

From `mcp/tsconfig.json`:
- `strict: true` (all strict type-checking enabled)
- Target: ES2022
- Module: Node16, moduleResolution: Node16
- Output: `dist/`, source: `src/`
- Generates declaration maps and source maps

### Import/Export Conventions

**MANDATORY patterns:**

1. **Local imports MUST include `.js` extension:**
   ```ts
   import { formatResponse } from '../response.js';
   import type { Deps } from '../deps.js';
   ```

2. **Node.js builtins MUST use `node:` prefix:**
   ```ts
   import { readFileSync } from 'node:fs';
   import { join } from 'node:path';
   ```

3. **Type-only imports MUST use `import type`:**
   ```ts
   import type { Deps } from '../deps.js';
   import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
   ```

4. **Re-exports use barrel pattern** (`index.ts` files):
   ```ts
   export { registerSelectBlindTool } from './select-blind.js';
   export { registerSkipBlindTool } from './skip-blind.js';
   ```

### Naming Conventions

- **Files**: camelCase (e.g., `select-blind.ts`, `bridge-client.ts`)
- **Interfaces/Classes**: PascalCase (e.g., `BridgeClient`, `Deps`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `ANNOTATIONS`, `BLIND_TOOL_PREFIX`)
- **Functions**: camelCase (e.g., `formatResponse`, `toolError`)
- **Registration functions**: `register*` prefix (e.g., `registerSelectBlindTool`)

### Directory Structure

```
mcp/src/
├── index.ts              # Entry point, wires dependencies
├── server.ts             # runServer() accepts Deps interface
├── deps.ts               # Dependency injection interface
├── response.ts           # Response formatting utilities
├── bridge/               # Socket client for Lua mod communication
├── tools/                # MCP tool implementations (11 modules)
├── prompts/              # MCP prompt providers
├── resources/            # MCP resources (rules)
└── docs/                 # Protocol specs, contracts, QA runbooks
```

**Barrel pattern**: Each subdirectory exports through `index.ts`. Import from the barrel, not individual files:

```ts
// CORRECT
import { registerAllTools } from './tools/index.js';

// WRONG
import { registerSelectBlindTool } from './tools/select-blind.js';
```

### Code Organization Rules

1. **Zod schemas MUST use `.strict()` and chain `.describe()`:**
   ```ts
   const inputSchema = z.object({
     blind_type: z.enum(['small', 'big', 'boss']).describe('Which blind to select')
   }).strict();
   ```

2. **Tool metadata uses `ANNOTATIONS` as const:**
   ```ts
   const ANNOTATIONS = {
     readOnlyHint: true,
     destructiveHint: false,
     idempotentHint: true,
     openWorldHint: false
   } as const;
   ```

3. **Response format**: Tools accept `format?: "markdown" | "json"` with default of `"markdown"`. Wrap with `formatResponse()` or `toolError()`.

4. **Error handling pattern**:
   ```ts
   try {
     const result = await deps.bridgeClient.sendCommand('action', params);
     return formatResponse(result, format);
   } catch (error) {
     if (error instanceof BridgeError) {
       return toolError(error.message);
     }
     throw error; // Re-throw unknown errors
   }
   ```

5. **Dependency injection**: All tools receive `Deps` interface, not concrete instances:
   ```ts
   function registerMyTool(server: Server, deps: Deps) {
     // Use deps.bridgeClient, deps.rulesService
   }
   ```

6. **Extensive JSDoc required** on:
   - All exported functions
   - All interfaces and types
   - File-level block comments (`/** */` at top of file)

7. **Arrow functions for callbacks**, `const` for local functions, `function` keyword for exported functions.

8. **Undefined checks**: Use `!== undefined`, not falsy checks.

9. **Return unwrapping**: Use spread pattern for MCP tool handlers:
   ```ts
   return { ...formatResponse(data, format) };
   ```

## Build and Deployment

### Build Process

```bash
cd mcp && pnpm build
```

- Compiles TypeScript from `src/` to `dist/`
- Generates `.d.ts` declaration files
- Generates source maps and declaration maps
- Output: `mcp/dist/index.js` (MCP server entry point)

### Running the MCP Server

```bash
# Production (compiled)
node mcp/dist/index.js

# Development (tsx with watch)
cd mcp && pnpm dev
```

### MCP Client Configuration

Configure your MCP client to launch the server:

```json
{
  "mcpServers": {
    "balatro": {
      "command": "node",
      "args": ["/path/to/balatro-mcp/mcp/dist/index.js"]
    }
  }
}
```

**Requirements**: Balatro must be running with the `balatro_mcp` mod loaded for tools to work.

### Mod Installation

```bash
# Sync repo mods to Balatro Mods directory
make install-mods

# Combined: sync mods + launch Balatro
make run
```

The Makefile uses `rsync` to sync `mods/balatro_mcp/` to `~/Library/Application Support/Balatro/Mods/balatro_mcp/` (excluding the `bridge/` directory).

## Debugging and Troubleshooting

### MCP Tools Report `GAME_NOT_RUNNING`

- Verify Balatro is running with Lovely injector
- Confirm `balatro_mcp` mod is loaded (check in-game mod list)
- Check socket exists: `ls -la /tmp/balatro-mcp.sock`
- Verify MCP server is running and connected

### Balatro Does Not Reflect Mod Changes

- Lua files are loaded at game startup, not dynamically
- Run `make install-mods` to sync changes
- **Restart Balatro completely** (no hot-reload for Lua)

### MCP Server Cannot Start

- Build the server first: `cd mcp && pnpm build`
- Check Node.js version: `node --version` (must be ≥18)
- Verify entry point exists: `ls mcp/dist/index.js`

### Type Errors After Changes

```bash
cd mcp && pnpm typecheck
```

Fix all errors shown. TypeScript strict mode is enabled—no type suppressions allowed.

## Additional Notes

### Architecture Notes

- **Dependency injection**: The `Deps` interface (`src/deps.ts`) enables testing. `runServer()` accepts mock implementations.
- **Socket client**: `BridgeClient` (`src/bridge/socket-client.ts`) encapsulates all Unix socket communication. Uses JSON-RPC 2.0 over newline-delimited frames.
- **Phase guards**: Game state validation prevents invalid actions (see `mcp/docs/phase-guards.md`).

### Common Gotchas

- **Import extensions**: Always include `.js` on local imports, even though source files are `.ts`
- **Node prefix**: Always use `node:` prefix for built-in modules
- **Barrel imports**: Import from `index.ts`, not individual files
- **Zod strict mode**: All input schemas must call `.strict()` to reject unknown fields
- **No type suppression**: Never use `as any`, `@ts-ignore`, or `@ts-expect-error`

### Performance Considerations

- Entity data files are loaded once at server startup
- Socket communication is synchronous request/response
- No caching layer exists—every tool call hits the game directly

## Pull Request Guidelines

**Before submitting:**

1. Run `cd mcp && pnpm typecheck` - must pass with no errors
2. Run `cd mcp && pnpm build` - must complete successfully
3. Test changed tools manually with Balatro running
4. Update relevant docs in `mcp/docs/` if protocol or contracts changed

**Commit messages**: Use clear, descriptive commits. No specific format required.

**PR title**: `[component] Brief description` (e.g., `[bridge] Add socket reconnection logic`)

**PR description**: Include:
- Summary of changes
- What was tested
- Any blocked features or known issues
