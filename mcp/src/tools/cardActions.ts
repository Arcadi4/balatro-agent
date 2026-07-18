import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { normalizeCardId } from "./cardIds.js";
import USE_CONSUMABLE_DESCRIPTION from "./descriptions/use-consumable.txt" with { type: "text" };
import SELL_CARD_DESCRIPTION from "./descriptions/sell-card.txt" with { type: "text" };

const useConsumableSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the consumable card to use from your consumable slots."),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe("Ordered target hand card IDs. Required for targeted consumables; for Death, pass [source_card_id, destination_card_id]."),
  })
  .strict();

const sellCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the card to sell — must be a Joker or consumable in your slots."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeCardAction(
  deps: Deps,
  kind: "use_consumable" | "sell_card",
  cardId: string,
  targets?: string[],
) {
  let response;
  try {
    const seq = await deps.bridgeClient.sendCommand({ kind, args: { card_id: cardId, targets } });
    response = await deps.bridgeClient.awaitResponse(seq);
  } catch (err) {
    if (err instanceof BridgeError) {
      return toolError(err.code, err.message);
    }
    throw err;
  }

  if (!response.ok) {
    const code = response.error_code ?? "UNKNOWN_ERROR";
    const message = response.error_message ?? `Command ${kind} failed`;
    return toolError(code, message);
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  };

  return formatResponse(structured);
}

export function registerCardActionTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_use_consumable",
    {
      description: USE_CONSUMABLE_DESCRIPTION,
      inputSchema: useConsumableSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined;
      const envelope = await executeCardAction(deps, "use_consumable", normalizeCardId(args.card_id), targets);
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_sell_card",
    {
      description: SELL_CARD_DESCRIPTION,
      inputSchema: sellCardSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const envelope = await executeCardAction(deps, "sell_card", normalizeCardId(args.card_id));
      return { ...envelope };
    },
  );
}
