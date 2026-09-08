import { createHash } from "node:crypto"

import type { McpServer } from "@modelcontextprotocol/server"

import stakesMarkdown from "../../data/reference/stakes.md" with { type: "text" }

const STAKES_URI = "balatro://stakes"

const STAKES_VERSION = createHash("sha256").update(stakesMarkdown).digest("hex").slice(0, 8)

export function registerStakesResource(server: McpServer): void {
  server.registerResource(
    "stakes",
    STAKES_URI,
    {
      title: "Balatro Stakes",
      description:
        "Balatro stake reference: every stake difficulty (1-8), modifier summary, and wiki link for balatro_new_game.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: {
        version: STAKES_VERSION,
      },
    },
    () => ({
      contents: [
        {
          uri: STAKES_URI,
          mimeType: "text/markdown",
          text: stakesMarkdown,
        },
      ],
    }),
  )
}
