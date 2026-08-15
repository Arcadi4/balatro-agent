import type { McpServer } from "@modelcontextprotocol/server"

import HANDBOOK_MARKDOWN from "./handbook.md" with { type: "text" }

const PROMPT_NAME = "balatro_play_handbook"

export function registerHandbookPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: "Balatro Play Handbook",
      description:
        "Live-play operating guidance that prioritizes game-state inspection and verified Balatro Wiki rules.",
    },
    () => ({
      description: "Balatro play handbook",
      messages: [
        {
          role: "user",
          content: { type: "text", text: HANDBOOK_MARKDOWN },
        },
      ],
    }),
  )
}
