import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import { cardIdSchema, normalizeCardId, normalizeCardIds } from "./cardIds.js";

const OPEN_BOOSTER_DESCRIPTION =
  "Opens a Booster Pack that you have already purchased from the shop, revealing the cards inside for selection. " +
  "Use this when you have bought a Booster Pack (Arcana, Celestial, Spectral, Standard, or Buffoon) and want to see its contents and begin choosing cards from it. " +
  "Do NOT call this outside of the SHOP phase, on a card_id that does not reference a purchased Booster Pack, or while another Booster Pack is already open and awaiting resolution. " +
  "Error codes: WRONG_PHASE (not in SHOP), INVALID_TARGET (card_id does not reference a valid purchased Booster Pack), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const SELECT_BOOSTER_CARD_DESCRIPTION =
  "Selects a card from an open Booster Pack, adding it to your collection or applying its effect immediately if it is a consumable with targets specified. " +
  "Use this when a Booster Pack is open and you want to pick one of the revealed cards — for example, choosing a Joker from a Buffoon Pack, a Tarot from an Arcana Pack, or a playing card from a Standard Pack. " +
  "Do NOT call this when no Booster Pack is currently open, on a card_id not present among the revealed pack contents, or when you have already used all your picks for this pack; pass targets only for consumables that operate on specific cards (e.g. Tarots that enhance hand cards). " +
  "Error codes: WRONG_PHASE (no Booster Pack open), INVALID_TARGET (card_id not in open pack contents, or targets invalid for this card), NO_SLOT (no open slot to receive the selected card), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const SKIP_BOOSTER_DESCRIPTION =
  "Skips the remaining picks in an open Booster Pack, closing it and returning to the shop without selecting any more cards. " +
  "Use this when a Booster Pack is open but you do not want any of the remaining revealed cards, or you have already picked the cards you want and wish to forfeit the remaining selections. " +
  "Do NOT call this when no Booster Pack is currently open; this action is irreversible — once skipped, the remaining cards in the pack are lost permanently. " +
  "Error codes: WRONG_PHASE (no Booster Pack open), GAME_NOT_RUNNING (Balatro not running or heartbeat stale >5s), PROTOCOL_MISMATCH (server/mod version mismatch).";

const openBoosterSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the Booster Pack in the shop to open. Must reference a purchased Booster Pack available in the current SHOP phase."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const selectBoosterCardSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe("The ID of the card inside the open Booster Pack to select. Must reference a card currently revealed in the open pack."),
    targets: z
      .array(cardIdSchema)
      .optional()
      .describe("Optional array of target card IDs for consumables that operate on specific cards (e.g. Tarots that enhance hand cards). Omit for cards that take no targets."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const skipBoosterSchema = z
  .object({
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const OPEN_BOOSTER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const SELECT_BOOSTER_CARD_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const SKIP_BOOSTER_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

async function executeBoosterCommand(
  deps: Deps,
  command:
    | { kind: "open_booster"; args: { card_id: string } }
    | { kind: "select_booster_card"; args: { card_id: string; targets?: string[] } }
    | { kind: "skip_booster" },
  format: ResponseFormat,
) {
  let response;
  try {
    const payload: { kind: string; args?: Record<string, unknown> } = { kind: command.kind };
    if ("args" in command) {
      payload.args = command.args;
    }
    const seq = await deps.bridgeClient.sendCommand(payload);
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

export function registerBoosterTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_open_booster",
    {
      description: OPEN_BOOSTER_DESCRIPTION,
      inputSchema: openBoosterSchema,
      annotations: OPEN_BOOSTER_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const cardId = normalizeCardId(args.card_id);
      const envelope = await executeBoosterCommand(
        deps,
        { kind: "open_booster", args: { card_id: cardId } },
        format,
      );
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_select_booster_card",
    {
      description: SELECT_BOOSTER_CARD_DESCRIPTION,
      inputSchema: selectBoosterCardSchema,
      annotations: SELECT_BOOSTER_CARD_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const cardId = normalizeCardId(args.card_id);
      const targets = args.targets ? normalizeCardIds(args.targets) : undefined;
      const envelope = await executeBoosterCommand(
        deps,
        { kind: "select_booster_card", args: { card_id: cardId, targets } },
        format,
      );
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_skip_booster",
    {
      description: SKIP_BOOSTER_DESCRIPTION,
      inputSchema: skipBoosterSchema,
      annotations: SKIP_BOOSTER_ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const envelope = await executeBoosterCommand(
        deps,
        { kind: "skip_booster" },
        format,
      );
      return { ...envelope };
    },
  );
}
