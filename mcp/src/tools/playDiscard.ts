import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import PLAY_HAND_DESCRIPTION from "./descriptions/play-hand.txt" with { type: "text" };
import DISCARD_HAND_DESCRIPTION from "./descriptions/discard-hand.txt" with { type: "text" };

const inputSchema = z.object({}).strict();

function cloneRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

function playHandToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const result = cloneRecord(d.data) ?? {};
  const lines: string[] = [];

  lines.push("# Hand Played");
  lines.push("");
  lines.push(`- **Cards played:** ${String(result.cards_played ?? "unknown")}`);
  if (result.points_gained !== undefined)
    lines.push(`- **Points gained:** ${String(result.points_gained)}`);
  if (result.score_before !== undefined && result.score_after !== undefined) {
    lines.push(`- **Score:** ${String(result.score_before)} -> ${String(result.score_after)}`);
  }
  if (result.blind_chips !== undefined)
    lines.push(`- **Blind target:** ${String(result.blind_chips)}`);
  if (result.blind_defeated !== undefined) {
    lines.push(`- **Blind defeated:** ${String(result.blind_defeated)}`);
  }
  if (result.hands_played_before !== undefined && result.hands_played_after !== undefined) {
    lines.push(
      `- **Hands played:** ${String(result.hands_played_before)} -> ${String(result.hands_played_after)}`,
    );
  }
  if (result.timed_out) {
    lines.push(
      "- **Warning:** Scoring wait timed out; score fields reflect the latest observed game state.",
    );
  }

  return lines.join("\n");
}

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

async function executePlayDiscardCommand(deps: Deps, kind: "play_hand" | "discard_hand") {
  let response;
  try {
    const seq = await deps.bridgeClient.sendCommand({ kind });
    response = await deps.bridgeClient.awaitResponse(seq, {
      timeoutMs: kind === "play_hand" ? 15_000 : undefined,
    });
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

  return formatResponse(
    structured,
    kind === "play_hand" ? { toMarkdown: playHandToMarkdown } : undefined,
  );
}

export function registerPlayDiscardTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_play_hand",
    {
      description: PLAY_HAND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const envelope = await executePlayDiscardCommand(deps, "play_hand");
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_discard_hand",
    {
      description: DISCARD_HAND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const envelope = await executePlayDiscardCommand(deps, "discard_hand");
      return { ...envelope };
    },
  );
}
