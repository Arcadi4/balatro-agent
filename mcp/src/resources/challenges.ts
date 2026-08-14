import type { McpServer } from "@modelcontextprotocol/server"

import challengesMarkdown from "../../data/reference/challenges.md" with { type: "text" }

const CHALLENGES_URI = "balatro://challenges"

const CHALLENGES_VERSION = new Bun.CryptoHasher("sha256")
  .update(challengesMarkdown)
  .digest("hex")
  .slice(0, 8)

export function registerChallengesResource(server: McpServer): void {
  server.registerResource(
    "challenges",
    CHALLENGES_URI,
    {
      title: "Balatro Challenges",
      description:
        "Balatro challenge reference: every challenge id, rule summary, and wiki link for balatro_new_game.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: {
        version: CHALLENGES_VERSION,
      },
    },
    () => ({
      contents: [
        {
          uri: CHALLENGES_URI,
          mimeType: "text/markdown",
          text: challengesMarkdown,
        },
      ],
    }),
  )
}
