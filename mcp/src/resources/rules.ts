import type { McpServer } from "@modelcontextprotocol/server"

import rulesMarkdown from "../../data/rules/global.md" with { type: "text" }

const RULES_URI = "balatro://rules/global"
export const RULES_MARKDOWN = rulesMarkdown

export const RULES_VERSION = new Bun.CryptoHasher("sha256")
  .update(RULES_MARKDOWN)
  .digest("hex")
  .slice(0, 8)

export function registerRulesResource(server: McpServer): void {
  server.registerResource(
    "global_rules",
    RULES_URI,
    {
      title: "Balatro Game Rules",
      description:
        "Balatro game rules reference: run loop, phases, poker hands, money, modifiers, packs, stakes.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: {
        version: RULES_VERSION,
      },
    },
    () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: "text/markdown",
          text: RULES_MARKDOWN,
        },
      ],
    }),
  )
}
