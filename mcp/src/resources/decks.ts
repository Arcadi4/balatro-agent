import { createHash } from "node:crypto"

import type { McpServer } from "@modelcontextprotocol/server"

import decksMarkdown from "../../data/reference/decks.md" with { type: "text" }

const DECKS_VERSION = createHash("sha256").update(decksMarkdown).digest("hex").slice(0, 8)

export const DECKS_URI = "balatro://decks"

export function readDecksResource(): { uri: string; markdown: string } {
  return { uri: DECKS_URI, markdown: decksMarkdown }
}

export function registerDecksResource(server: McpServer): void {
  server.registerResource(
    "decks",
    DECKS_URI,
    {
      title: "Balatro Decks",
      description:
        "Balatro deck reference: every playable deck key, effect summary, and wiki link for balatro_new_game.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: { version: DECKS_VERSION },
    },
    () => ({ contents: [{ uri: DECKS_URI, mimeType: "text/markdown", text: decksMarkdown }] }),
  )
}
