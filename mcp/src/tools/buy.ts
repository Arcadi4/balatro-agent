import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { cardIdSchema, normalizeCardId, normalizeCardIds } from "./cardIds.js";
import BUY_CARD_DESCRIPTION from "./buy-card.txt" with { type: "text" };
import BUY_AND_USE_CARD_DESCRIPTION from "./buy-and-use-card.txt" with { type: "text" };

const buyCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "The ID of the card in the shop to purchase. Must reference a card currently offered in the SHOP phase.",
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

  return formatResponse(structured);
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
      const cardId = normalizeCardId(args.card_id);
      const envelope = await executeBuyCommand(deps, { kind: "buy_card", card_id: cardId });
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
      const cardId = normalizeCardId(args.card_id);
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined;
      const envelope = await executeBuyCommand(
        deps,
        { kind: "buy_and_use_card", card_id: cardId, targets },
      );
      return { ...envelope };
    },
  );
}
