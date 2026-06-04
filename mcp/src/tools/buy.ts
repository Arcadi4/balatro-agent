import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { cardIdSchema, normalizeCardId, normalizeCardIds } from "./cardIds.js";

const BUY_CARD_DESCRIPTION =
  "Purchases a card from the shop. Jokers are placed into Joker slots, Tarot/Planet/Spectral cards are placed into consumable slots, and Vouchers are redeemed immediately as permanent run effects. " +
  "Use this when you have enough dollars and an open slot for the card type, or when you want to redeem the shop Voucher. " +
  "Requires SHOP, a current shop card_id, enough dollars, and any needed slot capacity; use balatro_buy_and_use_card to buy and immediately apply a consumable.";

const BUY_AND_USE_CARD_DESCRIPTION =
  "Purchases a consumable card (Tarot, Planet, or Spectral) from the shop and immediately uses it in a single atomic action, applying its effect to the game state and bypassing the consumable slot entirely. " +
  "Use this when you want to spend dollars on a consumable purely for its immediate effect — for example, buying a Tarot to enhance specific hand cards via the optional targets array, or buying a Planet to upgrade a poker hand level. " +
  "Requires SHOP, an affordable Tarot/Planet/Spectral shop card, and valid targets only when that consumable operates on specific cards.";

const buyCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the card in the shop to purchase. Must reference a card currently offered in the SHOP phase.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe(
        "Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries.",
      ),
  })
  .strict();

const buyAndUseCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the consumable card in the shop to purchase and immediately use. Must be a Tarot, Planet, or Spectral card currently offered in the SHOP phase.",
      ),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe(
        "Optional array of target card IDs for consumables that operate on specific cards (e.g. Tarots that enhance hand cards). Omit for consumables that take no targets.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe(
        "Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries.",
      ),
  })
  .strict();

const BUY_CARD_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

const BUY_AND_USE_CARD_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeBuyCommand(
  deps: Deps,
  command:
    | { kind: "buy_card"; card_id: string }
    | { kind: "buy_and_use_card"; card_id: string; targets?: string[] },
  format: ResponseFormat,
) {
  let response;
  try {
    const args: Record<string, unknown> =
      command.kind === "buy_card"
        ? { card_id: command.card_id }
        : { card_id: command.card_id, targets: command.targets };
    const seq = await deps.bridgeClient.sendCommand({ kind: command.kind, args });
    response = await deps.bridgeClient.awaitResponse(seq);
  } catch (err) {
    if (err instanceof BridgeError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }

  if (!response.ok) {
    const code = response.error_code ?? "UNKNOWN_ERROR";
    const message = response.error_message ?? `Command ${command.kind} failed`;
    return toolError(code, message);
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  };

  return formatResponse(structured, format);
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
      const format: ResponseFormat = args.response_format ?? "markdown";
      const cardId = normalizeCardId(args.card_id);
      const envelope = await executeBuyCommand(deps, { kind: "buy_card", card_id: cardId }, format);
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_buy_and_use_card",
    {
      description: BUY_AND_USE_CARD_DESCRIPTION,
      inputSchema: buyAndUseCardSchema,
      annotations: BUY_AND_USE_CARD_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const cardId = normalizeCardId(args.card_id);
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined;
      const envelope = await executeBuyCommand(
        deps,
        { kind: "buy_and_use_card", card_id: cardId, targets },
        format,
      );
      return { ...envelope };
    },
  );
}
