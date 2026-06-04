import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { cardIdSchema, normalizeCardIds } from "./cardIds.js";

const SELECT_HAND_CARDS_DESCRIPTION =
  "Highlights (selects) specific cards in the player's hand for a subsequent play or discard action, using replace-mode semantics so each call replaces any previously selected cards entirely with the new set. " +
  "Pass an empty array to deselect all cards, or pass card IDs from the current state to highlight that exact set; order does not matter and duplicate IDs are not meaningful. " +
  "Use this before balatro_play_hand or balatro_discard_hand. Requires SELECTING_HAND, current hand card IDs, and no more than the legal hand size (typically 5).";

const SORT_HAND_DESCRIPTION =
  "Reorders the cards in the player's hand to the explicit order specified by an array of card IDs, where the first ID becomes the leftmost card and the last ID becomes the rightmost. " +
  "This is a visual/organizational action that does not consume any game resources (hands or discards) and does not alter card values, ranks, suits, or any gameplay-relevant state beyond display order. " +
  "Use this to reorganize cards for better visibility before deciding what to play. Requires SELECTING_HAND and an order array matching the current hand contents.";

const selectHandCardsSchema = z
  .object({
    card_ids: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of card IDs to highlight. Empty array deselects all cards. Each ID must reference a card currently in the player's hand. Order does not matter; this is a replace-mode operation.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const sortHandSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of card IDs in the desired left-to-right display order. Each ID must reference a card currently in the player's hand. The array should contain exactly the cards in the hand to fully reorder them.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeHandCommand(
  deps: Deps,
  command: { kind: "select_hand_cards"; card_ids: string[] } | { kind: "sort_hand"; order: string[] },
  format: ResponseFormat,
) {
  let response;
  try {
    const seq = await deps.bridgeClient.sendCommand({
      kind: command.kind,
      args:
        command.kind === "select_hand_cards"
          ? { card_ids: command.card_ids }
          : { order: command.order },
    });
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

export function registerHandTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_select_hand_cards",
    {
      description: SELECT_HAND_CARDS_DESCRIPTION,
      inputSchema: selectHandCardsSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const cardIds = normalizeCardIds(args.card_ids);
      const envelope = await executeHandCommand(
        deps,
        { kind: "select_hand_cards", card_ids: cardIds },
        format,
      );
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_sort_hand",
    {
      description: SORT_HAND_DESCRIPTION,
      inputSchema: sortHandSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const order = normalizeCardIds(args.order);
      const envelope = await executeHandCommand(
        deps,
        { kind: "sort_hand", order },
        format,
      );
      return { ...envelope };
    },
  );
}
