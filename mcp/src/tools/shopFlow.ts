import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import REROLL_SHOP_DESCRIPTION from "./descriptions/reroll-shop.txt" with { type: "text" };
import LEAVE_SHOP_DESCRIPTION from "./descriptions/leave-shop.txt" with { type: "text" };
import CASH_OUT_DESCRIPTION from "./descriptions/cash-out.txt" with { type: "text" };

const inputSchema = z.object({}).strict();

const REROLL_SHOP_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

const LEAVE_SHOP_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

const CASH_OUT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

type ShopFlowKind = "reroll_shop" | "leave_shop" | "cash_out";

async function executeShopFlowCommand(
  deps: Deps,
  kind: ShopFlowKind,
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
    return toolError(code, message);
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  };

  return formatResponse(structured);
}

export function registerShopFlowTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_reroll_shop",
    {
      description: REROLL_SHOP_DESCRIPTION,
      inputSchema,
      annotations: REROLL_SHOP_ANNOTATIONS,
    },
    async () => {
      const envelope = await executeShopFlowCommand(deps, "reroll_shop");
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
    async () => {
      const envelope = await executeShopFlowCommand(deps, "leave_shop");
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
    async () => {
      const envelope = await executeShopFlowCommand(deps, "cash_out");
      return { ...envelope };
    },
  );
}
