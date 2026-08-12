import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import SELECT_BLIND_DESCRIPTION from "./select-blind.txt" with { type: "text" };
import SKIP_BLIND_DESCRIPTION from "./skip-blind.txt" with { type: "text" };

const inputSchema = z.object({}).strict();

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeBlindCommand(
  deps: Deps,
  kind: "select_blind" | "skip_blind",
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

export function registerBlindTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_select_blind",
    {
      description: SELECT_BLIND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const envelope = await executeBlindCommand(deps, "select_blind");
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_skip_blind",
    {
      description: SKIP_BLIND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const envelope = await executeBlindCommand(deps, "skip_blind");
      return { ...envelope };
    },
  );
}
