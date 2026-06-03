import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";

const REROLL_SHOP_DESCRIPTION =
  "Rerolls the current shop offerings, replacing the displayed cards with a fresh set generated from the run's seed and spending the current reroll cost in dollars. " +
  "Use this when the current shop offerings are not useful for your build and you have enough dollars to afford the rising reroll cost (which scales each time within the same shop visit). " +
  "Do NOT call this outside of the SHOP phase, when you cannot afford the current reroll cost, or when a Voucher restricts rerolling; this affects only the card row, not Booster Packs or Vouchers. " +
  "Error codes: WRONG_PHASE (not in SHOP), INSUFFICIENT_FUNDS (not enough dollars to pay the current reroll cost), GAME_NOT_RUNNING (Balatro not running), INSTANCE_BUSY (another MCP client already owns the bridge connection), PROTOCOL_MISMATCH (server/mod version mismatch).";

const LEAVE_SHOP_DESCRIPTION =
  "Leaves the current shop and advances the run to the next BLIND_SELECT phase, finalizing all purchases and rerolls made during this shop visit. " +
  "Use this when you are done buying cards, opening Booster Packs, and rerolling, and want to proceed to the next ante's blind selection. " +
  "Do NOT call this outside of the SHOP phase, while a Booster Pack is still open and awaiting picks (resolve the pack first), or before cashing out from the prior round if a cash-out is still pending. " +
  "Error codes: WRONG_PHASE (not in SHOP), INVALID_TARGET (shop cannot be left, e.g. an open Booster Pack still requires resolution), GAME_NOT_RUNNING (Balatro not running), INSTANCE_BUSY (another MCP client already owns the bridge connection), PROTOCOL_MISMATCH (server/mod version mismatch).";

const CASH_OUT_DESCRIPTION =
  "Cashes out the round-end rewards (blind reward, interest, hand and discard bonuses, and any per-Joker dollar effects) into your bankroll and transitions the run from ROUND_EVAL into the SHOP phase. " +
  "Use this immediately after defeating a blind when the game is presenting the cash-out screen and you are ready to enter the shop. " +
  "Do NOT call this outside of the ROUND_EVAL phase, before all end-of-round Joker effects have resolved, or expect it to be reversible — once cashed out, in non-endless runs the round cannot be replayed. " +
  "Error codes: WRONG_PHASE (not in ROUND_EVAL), GAME_NOT_RUNNING (Balatro not running), INSTANCE_BUSY (another MCP client already owns the bridge connection), PROTOCOL_MISMATCH (server/mod version mismatch).";

const inputSchema = z
  .object({
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const REROLL_SHOP_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const LEAVE_SHOP_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const CASH_OUT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

type ShopFlowKind = "reroll_shop" | "leave_shop" | "cash_out";

async function executeShopFlowCommand(
  deps: Deps,
  kind: ShopFlowKind,
  format: ResponseFormat,
) {
  let response;
  try {
    const seq = await deps.bridgeClient.sendCommand({ kind });
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
    return toolError(code, message, {
      seq: response.seq,
      applied_state_seq: response.applied_state_seq,
    });
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    seq: response.seq,
    applied_state_seq: response.applied_state_seq,
    data: response.data,
  };

  return formatResponse(structured, format);
}

export function registerShopFlowTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_reroll_shop",
    {
      description: REROLL_SHOP_DESCRIPTION,
      inputSchema,
      annotations: REROLL_SHOP_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeShopFlowCommand(deps, "reroll_shop", format);
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_leave_shop",
    {
      description: LEAVE_SHOP_DESCRIPTION,
      inputSchema,
      annotations: LEAVE_SHOP_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeShopFlowCommand(deps, "leave_shop", format);
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_cash_out",
    {
      description: CASH_OUT_DESCRIPTION,
      inputSchema,
      annotations: CASH_OUT_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeShopFlowCommand(deps, "cash_out", format);
      return { ...envelope };
    },
  );
}
