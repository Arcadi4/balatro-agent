import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import type { Deps } from "../deps.js"
import { toolError } from "../errors.js"
import { formatResponse } from "../response.js"
import { cardIdSchema, normalizeCardId, normalizeCardIds } from "./cardIds.js"
import OPEN_BOOSTER_DESCRIPTION from "./descriptions/open-booster.txt" with { type: "text" }
import SELECT_BOOSTER_CARD_DESCRIPTION from "./descriptions/select-booster-card.txt" with { type: "text" }
import SKIP_BOOSTER_DESCRIPTION from "./descriptions/skip-booster.txt" with { type: "text" }

const openBoosterSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the Booster Pack in the shop to open. Must reference a purchased Booster Pack available in the current SHOP phase.",
      ),
  })
  .strict()

const selectBoosterCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the card inside the open Booster Pack to select. Must reference a card currently revealed in the open pack.",
      ),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe(
        "Ordered target hand card IDs. Required for targeted consumables; for Death, pass [source_card_id, destination_card_id] so the source becomes a copy of the destination. Omit only for cards that take no targets.",
      ),
  })
  .strict()

const skipBoosterSchema = z.object({}).strict()

const OPEN_BOOSTER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const SELECT_BOOSTER_CARD_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const SKIP_BOOSTER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

async function executeBoosterCommand(
  deps: Deps,
  command:
    | { kind: "open_booster"; args: { card_id: string } }
    | { kind: "select_booster_card"; args: { card_id: string; targets?: string[] } }
    | { kind: "skip_booster" },
) {
  let response
  try {
    const payload: { kind: string; args?: Record<string, unknown> } = { kind: command.kind }
    if ("args" in command) {
      payload.args = command.args
    }
    const seq = await deps.bridgeClient.sendCommand(payload)
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

export function registerBoosterTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_open_booster",
    {
      description: OPEN_BOOSTER_DESCRIPTION,
      inputSchema: openBoosterSchema,
      annotations: OPEN_BOOSTER_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const envelope = await executeBoosterCommand(deps, {
        kind: "open_booster",
        args: { card_id: cardId },
      })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_select_booster_card",
    {
      description: SELECT_BOOSTER_CARD_DESCRIPTION,
      inputSchema: selectBoosterCardSchema,
      annotations: SELECT_BOOSTER_CARD_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined
      const envelope = await executeBoosterCommand(deps, {
        kind: "select_booster_card",
        args: { card_id: cardId, targets },
      })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_skip_booster",
    {
      description: SKIP_BOOSTER_DESCRIPTION,
      inputSchema: skipBoosterSchema,
      annotations: SKIP_BOOSTER_ANNOTATIONS,
    },
    async () => {
      const envelope = await executeBoosterCommand(deps, { kind: "skip_booster" })
      return { ...envelope }
    },
  )
}
