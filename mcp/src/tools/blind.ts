import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";

const SELECT_BLIND_DESCRIPTION =
  "Selects the currently presented blind to face it for the round, transitioning the game from BLIND_SELECT into SELECTING_HAND so cards are dealt. " +
  "Use this when you want to commit to playing the upcoming blind rather than skipping it for the Tag reward. " +
  "Requires BLIND_SELECT and a selectable blind; use balatro_skip_blind instead when your intent is to skip.";

const SKIP_BLIND_DESCRIPTION =
  "Skips the currently presented blind, forfeiting its cash reward in exchange for a Tag reward redeemed in the shop or later rounds. " +
  "Use this when the blind's chip target is too risky for your current build, or when the Tag reward outweighs the cash payout. " +
  "Requires BLIND_SELECT and a skippable non-Boss Blind; do NOT confuse it with balatro_skip_booster, which forfeits Booster Pack picks.";

const inputSchema = z
  .object({
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executeBlindCommand(
  deps: Deps,
  kind: "select_blind" | "skip_blind",
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
    return toolError(code, message);
  }

  const structured: Record<string, unknown> = {
    ok: response.ok,
    data: response.data,
  };

  return formatResponse(structured, format);
}

export function registerBlindTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_select_blind",
    {
      description: SELECT_BLIND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeBlindCommand(deps, "select_blind", format);
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
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeBlindCommand(deps, "skip_blind", format);
      return { ...envelope };
    },
  );
}
