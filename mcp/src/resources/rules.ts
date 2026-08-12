/**
 * Global rules resource: registers `balatro://rules/global` as a static MCP
 * resource backed by `mcp/data/rules/global.md`.
 *
 * The markdown is imported as text at build time (`type: "text"` attribute,
 * see text-imports.d.ts), so the content is embedded in the bundle and the
 * resource works from source, from the dist bundle, and from compiled
 * executables without a runtime file read.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import RULES_MARKDOWN from "../../data/rules/global.md" with { type: "text" }

const RULES_URI = "balatro://rules/global"
const RULES_MIME = "text/markdown"

const RULES_VERSION = new Bun.CryptoHasher("sha256")
  .update(RULES_MARKDOWN)
  .digest("hex")
  .substring(0, 8)

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
      },
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: RULES_MIME,
          text: RULES_MARKDOWN,
        },
      ],
    }),
  )
}

export function getRulesContent(): string {
  return RULES_MARKDOWN
}

export function getRulesVersion(): string {
  return RULES_VERSION
}
