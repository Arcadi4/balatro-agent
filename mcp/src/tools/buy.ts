import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import type { Deps } from "../deps.js"
import { toolError } from "../errors.js"
import { formatResponse } from "../response.js"
import { cardIdSchema, normalizeCardId, normalizeCardIds } from "./cardIds.js"
import BUY_BOOSTER_DESCRIPTION from "./descriptions/buy-booster.txt" with { type: "text" }
import BUY_CARD_DESCRIPTION from "./descriptions/buy-card.txt" with { type: "text" }
import BUY_CONSUMABLE_DESCRIPTION from "./descriptions/buy-consumable.txt" with { type: "text" }
import BUY_VOUCHER_DESCRIPTION from "./descriptions/buy-voucher.txt" with { type: "text" }

const buyCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the Joker or playing card in the shop to purchase. Must reference a card currently offered in the SHOP phase.",
      ),
  })
  .strict()

const buyConsumableSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the consumable (Tarot, Planet, or Spectral) in the shop to purchase. Must reference a card currently offered in the SHOP phase.",
      ),
    use: z
      .boolean()
      .describe(
        "Required. true to buy the card and immediately apply its effect (bypassing the consumable slot); false to buy and store it in a consumable slot.",
      ),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe(
        "Ordered target hand card IDs, valid only when use=true and the consumable operates on specific cards (e.g. Tarots that enhance hand cards). For Death, pass [source_card_id, destination_card_id] so the source becomes a copy of the destination. Omit for consumables that take no targets.",
      ),
  })
  .strict()

const buyVoucherSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the Voucher in the shop to purchase and redeem. Must reference a Voucher currently offered in the SHOP phase.",
      ),
  })
  .strict()

const buyBoosterSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the Booster Pack in the shop to buy and open. Must reference a Booster Pack currently offered in the SHOP phase.",
      ),
  })
  .strict()

const BUY_CARD_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const BUY_CONSUMABLE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const BUY_VOUCHER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const BUY_BOOSTER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

type BuyCommand =
  | { kind: "buy_card"; card_id: string }
  | { kind: "buy_consumable"; card_id: string; use: boolean; targets?: string[] }
  | { kind: "buy_voucher"; card_id: string }
  | { kind: "buy_booster"; card_id: string }

async function executeBuyCommand(deps: Deps, command: BuyCommand) {
  let response
  try {
    const args: Record<string, unknown> = { card_id: command.card_id }
    if (command.kind === "buy_consumable") {
      args.use = command.use
      if (command.targets) {
        args.targets = command.targets
      }
    }
    const seq = await deps.bridgeClient.sendCommand({ kind: command.kind, args })
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

export function registerBuyTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_buy_card",
    {
      description: BUY_CARD_DESCRIPTION,
      inputSchema: buyCardSchema,
      annotations: BUY_CARD_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const envelope = await executeBuyCommand(deps, { kind: "buy_card", card_id: cardId })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_buy_consumable",
    {
      description: BUY_CONSUMABLE_DESCRIPTION,
      inputSchema: buyConsumableSchema,
      annotations: BUY_CONSUMABLE_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined
      const envelope = await executeBuyCommand(deps, {
        kind: "buy_consumable",
        card_id: cardId,
        use: args.use,
        targets,
      })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_buy_voucher",
    {
      description: BUY_VOUCHER_DESCRIPTION,
      inputSchema: buyVoucherSchema,
      annotations: BUY_VOUCHER_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const envelope = await executeBuyCommand(deps, { kind: "buy_voucher", card_id: cardId })
      return { ...envelope }
    },
  )

  server.registerTool(
    "balatro_buy_booster",
    {
      description: BUY_BOOSTER_DESCRIPTION,
      inputSchema: buyBoosterSchema,
      annotations: BUY_BOOSTER_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id)
      const envelope = await executeBuyCommand(deps, { kind: "buy_booster", card_id: cardId })
      return { ...envelope }
    },
  )
}
