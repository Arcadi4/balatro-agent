import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import type { Deps } from "../deps.js"
import { toolError } from "../errors.js"
import { formatResponse } from "../response.js"
import { cardIdSchema, normalizeCardIds } from "./cardIds.js"
import REORDER_JOKERS_DESCRIPTION from "./descriptions/reorder-jokers.txt" with { type: "text" }

const reorderJokersSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of Joker card IDs in the desired left-to-right scoring order. Each ID must reference a Joker currently in the player's Joker area. The array should contain exactly the Jokers held to fully reorder them.",
      ),
  })
  .strict()

const REORDER_JOKERS_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

async function executeReorderJokersCommand(deps: Deps, order: string[]) {
  let response
  try {
    const seq = await deps.bridgeClient.sendCommand({
      kind: "reorder_jokers",
      args: { card_ids: order },
    })
    response = await deps.bridgeClient.awaitResponse(seq)
  } catch (err) {
    if (err instanceof BridgeError) {
      return toolError(err.code, err.message)
    }
    throw err
  }

  if (!response.ok) {
    const code = response.error_code ?? "UNKNOWN_ERROR"
    const message = response.error_message ?? "Command reorder_jokers failed"
    return toolError(code, message)
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  }

  return formatResponse(structured)
}

export function registerReorderJokersTool(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_reorder_jokers",
    {
      description: REORDER_JOKERS_DESCRIPTION,
      inputSchema: reorderJokersSchema,
      annotations: REORDER_JOKERS_ANNOTATIONS,
    },
    async (args) => {
      const order = normalizeCardIds(args.order)
      const envelope = await executeReorderJokersCommand(deps, order)
      return { ...envelope }
    },
  )
}
