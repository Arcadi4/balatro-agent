import type { McpServer } from "@modelcontextprotocol/server"

import { RULES_MARKDOWN, RULES_VERSION } from "../resources/rules.js"
import INSTRUCTION_BLOCK from "./strategy.md" with { type: "text" }

const PROMPT_NAME = "balatro_strategy_context"

export function registerStrategyPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: "Balatro Strategy Context",
      description:
        "Loads the global rules reference and instructions on canonical IDs and tool usage for advising on Balatro runs.",
    },
    () => ({
      description: `Balatro strategy context (rules version ${RULES_VERSION})`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${RULES_MARKDOWN}\n\n---\n\n${INSTRUCTION_BLOCK}`,
          },
        },
      ],
    }),
  )
}
