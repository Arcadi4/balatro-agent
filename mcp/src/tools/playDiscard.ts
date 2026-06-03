import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";

const PLAY_HAND_DESCRIPTION =
  "Plays the currently selected cards from your hand, scoring them against the active blind's chip target and consuming one of your limited hands for the round. " +
  "Use this after selecting cards via balatro_select_cards_for_hand when you are confident the resulting poker hand scores enough chips to make progress toward (or defeat) the blind. " +
  "Do NOT call this outside of the SELECTING_HAND phase, and do NOT call it when no cards are selected — select cards first with balatro_select_cards_for_hand. " +
  "Error codes: WRONG_PHASE (not in SELECTING_HAND), INVALID_TARGET (no cards currently selected for play), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const DISCARD_HAND_DESCRIPTION =
  "Discards the currently selected cards from your hand, drawing replacements from the deck and consuming one of your limited discards for the round. " +
  "Use this after selecting cards via balatro_select_cards_for_hand when you want to cycle unwanted cards in search of better scoring combinations before committing a play. " +
  "Do NOT call this outside of the SELECTING_HAND phase, and do NOT call it when you have zero discards remaining — check game state first. " +
  "Error codes: WRONG_PHASE (not in SELECTING_HAND), INVALID_TARGET (no cards currently selected for discard or zero discards remaining), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const inputSchema = z
  .object({
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

function playHandToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const result = (d.data ?? {}) as Record<string, unknown>;
  const lines: string[] = [];

  lines.push("# Hand Played");
  lines.push("");
  lines.push(`- **Cards played:** ${String(result.cards_played ?? "unknown")}`);
  if (result.points_gained !== undefined) lines.push(`- **Points gained:** ${String(result.points_gained)}`);
  if (result.score_before !== undefined && result.score_after !== undefined) {
    lines.push(`- **Score:** ${String(result.score_before)} -> ${String(result.score_after)}`);
  }
  if (result.blind_chips !== undefined) lines.push(`- **Blind target:** ${String(result.blind_chips)}`);
  if (result.blind_defeated !== undefined) {
    lines.push(`- **Blind defeated:** ${String(result.blind_defeated)}`);
  }
  if (result.hands_played_before !== undefined && result.hands_played_after !== undefined) {
    lines.push(`- **Hands played:** ${String(result.hands_played_before)} -> ${String(result.hands_played_after)}`);
  }
  if (result.timed_out) {
    lines.push("- **Warning:** Scoring wait timed out; score fields reflect the latest observed game state.");
  }

  return lines.join("\n");
}

const ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

async function executePlayDiscardCommand(
  deps: Deps,
  kind: "play_hand" | "discard_hand",
  format: ResponseFormat,
) {
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

  return formatResponse(structured, format, kind === "play_hand" ? { toMarkdown: playHandToMarkdown } : undefined);
}

export function registerPlayDiscardTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_play_hand",
    {
      description: PLAY_HAND_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executePlayDiscardCommand(deps, "play_hand", format);
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
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executePlayDiscardCommand(deps, "discard_hand", format);
      return { ...envelope };
    },
  );
}
