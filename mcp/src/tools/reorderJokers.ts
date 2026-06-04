import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { cardIdSchema, normalizeCardIds } from "./cardIds.js";

const REORDER_JOKERS_DESCRIPTION =
  "Reorders the Jokers in the player's Joker area to the explicit left-to-right order specified by an array of Joker card IDs, where the first ID becomes the leftmost Joker and the last ID becomes the rightmost. " +
  "This is a visual/organizational action that does not consume any game resources and does not alter Joker abilities, editions, or any gameplay-relevant state beyond display order; Joker scoring order is determined by the game engine independently of this visual arrangement. " +
  "Use this to reorganize Jokers for better visibility or mental bookkeeping. Requires a stable Joker-management phase and an order array containing exactly the current Joker IDs.";

const reorderJokersSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .min(0)
      .max(50)
      .describe(
        "Array of Joker card IDs in the desired left-to-right display order. Each ID must reference a Joker currently in the player's Joker area. The array should contain exactly the Jokers held to fully reorder them.",
      ),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const REORDER_JOKERS_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeReorderJokersCommand(
  deps: Deps,
  order: string[],
  format: ResponseFormat,
) {
  let response;
  try {
    const seq = await deps.bridgeClient.sendCommand({
      kind: "reorder_jokers",
      args: { card_ids: order },
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
    const message = response.error_message ?? "Command reorder_jokers failed";
    return toolError(code, message);
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  };

  return formatResponse(structured, format);
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
      const format: ResponseFormat = args.response_format ?? "markdown";
      const order = normalizeCardIds(args.order);
      const envelope = await executeReorderJokersCommand(deps, order, format);
      return { ...envelope };
    },
  );
}
