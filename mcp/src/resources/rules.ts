/**
 * Global rules resource: registers `balatro://rules/global` as a static MCP
 * resource backed by `mcp/data/rules/global.md`. Content loads once at module
 * init so the resource works without a bridge connection.
 *
 * Uses Bun-native file APIs: `Bun.file` for the lazy file reference and
 * `Bun.CryptoHasher` for the content-addressed version.
 */
import { resolve } from "node:path"

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { BunFile } from "bun"

const RULES_URI = "balatro://rules/global"
const RULES_MIME = "text/markdown"

// Path math: this file lives at src/resources/ when run from source, and the
// whole package is flattened into dist/index.js when bundled with `bun build`.
//   - src/resources/rules.ts          → ../../data = mcp/data ✓
//   - dist/index.js (flat bundle)     → ../data    = mcp/data ✓
//   - dist/resources/rules.js (tsc)   → ../../data = mcp/data ✓
const RULES_CANDIDATES = [
  resolve(import.meta.dir, "../../data/rules/global.md"), // src/resources/ layout
  resolve(import.meta.dir, "../data/rules/global.md"), // flat bundle layout
] as const

async function resolveRulesFile(): Promise<BunFile> {
  for (const candidate of RULES_CANDIDATES) {
    const file = Bun.file(candidate)
    if (await file.exists()) return file
  }
  // No candidate exists; let text() surface the error with a real path.
  return Bun.file(RULES_CANDIDATES[0])
}

const RULES_FILE = await resolveRulesFile()
const RULES_CONTENT = await RULES_FILE.text()

const RULES_VERSION = new Bun.CryptoHasher("sha256")
  .update(RULES_CONTENT)
  .digest("hex")
  .substring(0, 8)

const RULES_LAST_UPDATED = new Date(RULES_FILE.lastModified).toISOString()

/**
 * Register the global rules resource on an `McpServer`.
 * Safe to call without a bridge connection.
 */
export function registerRulesResource(server: McpServer): void {
  server.registerResource(
    "Global Game Rules",
    RULES_URI,
    {
      description:
        "Balatro game rules reference: run loop, phases, poker hands, money, modifiers, packs, stakes.",
      mimeType: RULES_MIME,
      _meta: {
        version: RULES_VERSION,
        lastUpdated: RULES_LAST_UPDATED,
      },
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: RULES_MIME,
          text: RULES_CONTENT,
        },
      ],
    }),
  )
}

export function getRulesContent(): string {
  return RULES_CONTENT
}

export function getRulesVersion(): string {
  return RULES_VERSION
}

export function getRulesLastUpdated(): string {
  return RULES_LAST_UPDATED
}
