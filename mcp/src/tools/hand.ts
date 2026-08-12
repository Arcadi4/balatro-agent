import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import type { Deps } from "../deps.js"
import { toolError } from "../errors.js"
import { formatResponse } from "../response.js"
import { cardIdSchema, normalizeCardIds } from "./cardIds.js"
import SELECT_HAND_CARDS_DESCRIPTION from "./descriptions/select-hand-cards.txt" with { type: "text" }
import SORT_HAND_DESCRIPTION from "./descriptions/sort-hand.txt" with { type: "text" }

const selectHandCardsSchema = z
  .object({
    card_ids: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of card IDs to highlight. Empty array deselects all cards. Each ID must reference a card currently in the player's hand. Order does not matter; this is a replace-mode operation.",
      ),
  })
  .strict()

const sortHandSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of card IDs in the desired left-to-right display order. Each ID must reference a card currently in the player's hand. The array should contain exactly the cards in the hand to fully reorder them.",
      ),
  })
  .strict()

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations

async function executeHandCommand(
  deps: Deps,
  command:
    | { kind: "select_hand_cards"; card_ids: string[] }
    | { kind: "sort_hand"; order: string[] },
) {
  let response
  try {
    const seq = await deps.bridgeClient.sendCommand({
      kind: command.kind,
      args:
        command.kind === "select_hand_cards"
          ? { card_ids: command.card_ids }
          : { order: command.order },
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
    const message = response.error_message ?? `Command ${command.kind} failed`
    return toolError(code, message)
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  }

  return formatResponse(structured)
}

export function registerHandTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_select_hand_cards",
    {
      description: SELECT_HAND_CARDS_DESCRIPTION,
      inputSchema: selectHandCardsSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const cardIds = normalizeCardIds(args.card_ids)
      const envelope = await executeHandCommand(deps, {
        kind: "select_hand_cards",
        card_ids: cardIds,
      })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_sort_hand",
    {
      description: SORT_HAND_DESCRIPTION,
      inputSchema: sortHandSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const order = normalizeCardIds(args.order)
      const envelope = await executeHandCommand(deps, { kind: "sort_hand", order })
      return { ...envelope }
    },
  )
}
