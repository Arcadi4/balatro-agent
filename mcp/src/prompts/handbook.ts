import type { McpServer } from "@modelcontextprotocol/server"

import HANDBOOK_MARKDOWN from "./handbook.md" with { type: "text" }

const PROMPT_NAME = "balatro_play_handbook"

export function registerHandbookPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: "Balatro Play Handbook",
      description:
        "How to drive a live Balatro run: read state before acting, trust each result's Next snapshot, verify rules against the Balatro Wiki, and weigh shop and blind decisions.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: HANDBOOK_MARKDOWN },
        },
      ],
    }),
  )
}
