/**
 * Strategy context prompt: registers the argsless `balatro_strategy_context`
 * prompt that returns the global rules markdown plus a short instruction
 * block on canonical IDs and tool usage. Independent of the bridge.
 *
 * The instruction block lives in `strategy.md` and is imported with Bun's
 * `type: "text"` import attribute (raw markdown in both the runtime and the
 * bundler), so the prompt stays editable markdown.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { getRulesContent, getRulesVersion, getRulesLastUpdated } from "../resources/rules.js"
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
      description: `Balatro strategy context (rules version ${getRulesVersion()}, updated ${getRulesLastUpdated()})`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${getRulesContent()}\n\n---\n\n${INSTRUCTION_BLOCK}`,
          },
        },
      ],
    }),
  )
}
