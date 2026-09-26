import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { asRecord, type CommandResultOptions } from "../response.js"
import BUY_BOOSTER_DESCRIPTION from "./descriptions/buy-booster.txt" with { type: "text" }
import BUY_CARD_DESCRIPTION from "./descriptions/buy-card.txt" with { type: "text" }
import BUY_CONSUMABLE_DESCRIPTION from "./descriptions/buy-consumable.txt" with { type: "text" }
import BUY_VOUCHER_DESCRIPTION from "./descriptions/buy-voucher.txt" with { type: "text" }
import CASH_OUT_DESCRIPTION from "./descriptions/cash-out.txt" with { type: "text" }
import CONTINUE_GAME_DESCRIPTION from "./descriptions/continue-game.txt" with { type: "text" }
import DISCARD_HAND_DESCRIPTION from "./descriptions/discard-hand.txt" with { type: "text" }
import LEAVE_SHOP_DESCRIPTION from "./descriptions/leave-shop.txt" with { type: "text" }
import NEW_GAME_DESCRIPTION from "./descriptions/new-game.txt" with { type: "text" }
import PLAY_HAND_DESCRIPTION from "./descriptions/play-hand.txt" with { type: "text" }
import REORDER_HAND_DESCRIPTION from "./descriptions/reorder-hand.txt" with { type: "text" }
import REORDER_JOKERS_DESCRIPTION from "./descriptions/reorder-jokers.txt" with { type: "text" }
import REROLL_BOSS_DESCRIPTION from "./descriptions/reroll-boss.txt" with { type: "text" }
import REROLL_SHOP_DESCRIPTION from "./descriptions/reroll-shop.txt" with { type: "text" }
import RESTART_DESCRIPTION from "./descriptions/restart.txt" with { type: "text" }
import SELECT_BLIND_DESCRIPTION from "./descriptions/select-blind.txt" with { type: "text" }
import SELECT_BOOSTER_CARD_DESCRIPTION from "./descriptions/select-booster-card.txt" with { type: "text" }
import SELECT_HAND_CARDS_DESCRIPTION from "./descriptions/select-hand-cards.txt" with { type: "text" }
import SELL_CARD_DESCRIPTION from "./descriptions/sell-card.txt" with { type: "text" }
import SKIP_BLIND_DESCRIPTION from "./descriptions/skip-blind.txt" with { type: "text" }
import SKIP_BOOSTER_DESCRIPTION from "./descriptions/skip-booster.txt" with { type: "text" }
import SORT_HAND_DESCRIPTION from "./descriptions/sort-hand.txt" with { type: "text" }
import USE_CONSUMABLE_DESCRIPTION from "./descriptions/use-consumable.txt" with { type: "text" }
import { commandWithSuccessor } from "./successor.js"

export const INSTANCE_ID_DESCRIPTION = "Target instance ID; defaults to the connected instance."

const instanceIdSchema = z.string().min(1).optional().describe(INSTANCE_ID_DESCRIPTION)
const emptySchema = z.object({ instance_id: instanceIdSchema }).strict()
const cardIdSchema = z
  .union([z.string().min(1), z.number().int()])
  .describe("Card ID from game state.")
const cardIdInputSchema = z
  .object({ card_id: cardIdSchema, instance_id: instanceIdSchema })
  .strict()
const targetsSchema = z
  .array(cardIdSchema)
  .max(50)
  .refine((cardIds) => new Set(cardIds.map(String)).size === cardIds.length, {
    message: "targets must not contain duplicates",
  })
  .optional()
  .describe("Target card IDs for effects that act on hand cards.")
const targetedCardSchema = z
  .object({ card_id: cardIdSchema, targets: targetsSchema, instance_id: instanceIdSchema })
  .strict()
const selectHandSchema = z
  .object({
    card_ids: z
      .array(cardIdSchema)
      .max(50)
      .refine((cardIds) => new Set(cardIds.map(String)).size === cardIds.length, {
        message: "card_ids must not contain duplicates",
      })
      .describe("Hand card IDs to highlight. Empty array clears selection."),
    instance_id: instanceIdSchema,
  })
  .strict()
const sortHandSchema = z
  .object({
    order: z.enum(["rank", "suit"]).describe("Sort by rank or suit."),
    instance_id: instanceIdSchema,
  })
  .strict()
const reorderHandSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .max(50)
      .describe("Every current hand card ID exactly once, in the desired left-to-right order."),
    instance_id: instanceIdSchema,
  })
  .strict()
const reorderJokersSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .max(50)
      .describe("Every current joker card ID exactly once, in the desired left-to-right order."),
    instance_id: instanceIdSchema,
  })
  .strict()
const buyConsumableSchema = z
  .object({
    card_id: cardIdSchema,
    use: z.boolean().describe("Apply the consumable immediately instead of storing it."),
    targets: targetsSchema.describe("Target hand card IDs; only valid together with use=true."),
    instance_id: instanceIdSchema,
  })
  .strict()
const normalRunSchema = z
  .object({
    deck: z.string().min(1).describe("Deck key (e.g. b_red, b_blue)."),
    stake: z.number().int().min(1).max(8).describe("Stake difficulty, 1-8."),
    seed: z.string().min(1).optional().describe("Seed for a seeded run."),
    instance_id: instanceIdSchema,
  })
  .strict()
const challengeRunSchema = z
  .object({
    challenge: z.string().min(1).describe("Challenge id (e.g. c_omelette_1)."),
    instance_id: instanceIdSchema,
  })
  .strict()
// The mod rejects a normal run without deck+stake and a challenge run carrying
// deck, stake, or seed, so encode both shapes as a closed union.
const newGameSchema = z.union([challengeRunSchema, normalRunSchema], {
  error: "Pass deck and stake for a normal run, or challenge alone for a challenge run.",
})
const successorSchema = z
  .object({
    uri: z.string(),
    phase: z.string(),
    settled: z.boolean(),
  })
  .strict()
const commandOutputSchema = z
  .object({ ok: z.literal(true), data: z.unknown().optional(), next: successorSchema.optional() })
  .strict()

const annotations = (destructive: boolean, idempotent: boolean): ToolAnnotations => ({
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: idempotent,
  openWorldHint: false,
})

function playHandToMarkdown(result: Record<string, unknown>): string {
  const data = asRecord(result.data) ?? {}
  const lines = [
    "# Hand Played",
    "",
    `- **Cards played:** ${String(data.cards_played ?? "unknown")}`,
  ]
  if (data.hand_name !== undefined) {
    const level = data.hand_level !== undefined ? ` (level ${String(data.hand_level)})` : ""
    lines.push(`- **Hand:** ${String(data.hand_name)}${level}`)
  }
  if (Array.isArray(data.played_cards) && data.played_cards.length > 0) {
    lines.push("- **Played cards:**")
    for (const value of data.played_cards) {
      const card = asRecord(value)
      if (!card) continue
      if (card.faced_down === true) {
        lines.push("  - Face-down card")
        continue
      }
      const modifiers = [card.enhancement, card.edition, card.seal].filter(
        (modifier): modifier is string => modifier !== undefined,
      )
      const suffix = modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""
      lines.push(`  - ${String(card.rank ?? "?")} of ${String(card.suit ?? "?")}${suffix}`)
    }
  }
  if (data.hand_chips !== undefined || data.hand_mult !== undefined) {
    const chips = data.hand_chips !== undefined ? `${String(data.hand_chips)} chips` : "?"
    const mult = data.hand_mult !== undefined ? `${String(data.hand_mult)} mult` : "?"
    lines.push(`- **Hand scoring:** ${chips} x ${mult}`)
  }
  if (data.chip_total !== undefined) {
    lines.push(`- **Hand score:** ${String(data.chip_total)}`)
  }
  if (data.points_gained !== undefined)
    lines.push(`- **Points gained:** ${String(data.points_gained)}`)
  if (data.score_before !== undefined && data.score_after !== undefined) {
    lines.push(`- **Score:** ${String(data.score_before)} -> ${String(data.score_after)}`)
  }
  if (data.blind_chips !== undefined) lines.push(`- **Blind target:** ${String(data.blind_chips)}`)
  if (data.blind_defeated !== undefined) {
    lines.push(`- **Blind defeated:** ${String(data.blind_defeated)}`)
  }
  if (data.hands_played_before !== undefined && data.hands_played_after !== undefined) {
    lines.push(
      `- **Hands played:** ${String(data.hands_played_before)} -> ${String(data.hands_played_after)}`,
    )
  }
  return lines.join("\n")
}

// The mod previews the selection through the game's own hand evaluation, so the
// agent can see what a selection scores before spending a hand on it.
function handSelectionToMarkdown(result: Record<string, unknown>): string {
  const data = asRecord(result.data) ?? {}
  const name = data.hand_name
  if (name === undefined) return "Cards selected."
  const level = data.hand_level !== undefined ? ` (level ${String(data.hand_level)})` : ""
  const lines = [`Selected ${String(data.selected ?? "?")} cards as ${String(name)}${level}.`]
  if (data.hand_chips !== undefined || data.hand_mult !== undefined) {
    const chips = data.hand_chips !== undefined ? `${String(data.hand_chips)} chips` : "?"
    const mult = data.hand_mult !== undefined ? `${String(data.hand_mult)} mult` : "?"
    lines.push(`Base scoring: ${chips} x ${mult}, before card chips, jokers and blind effects.`)
  }
  return lines.join("\n")
}

interface ActionTool {
  name: string
  title: string
  description: string
  command: string
  annotations: ToolAnnotations
  options?: CommandResultOptions
}

const NO_ARG_TOOLS: ActionTool[] = [
  {
    name: "balatro_select_blind",
    title: "Select Blind",
    description: SELECT_BLIND_DESCRIPTION,
    command: "select_blind",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_skip_blind",
    title: "Skip Blind",
    description: SKIP_BLIND_DESCRIPTION,
    command: "skip_blind",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_play_hand",
    title: "Play Hand",
    description: PLAY_HAND_DESCRIPTION,
    command: "play_hand",
    annotations: annotations(true, false),
    options: { timeoutMs: 15_000, toMarkdown: playHandToMarkdown },
  },
  {
    name: "balatro_discard_hand",
    title: "Discard Hand",
    description: DISCARD_HAND_DESCRIPTION,
    command: "discard_hand",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_reroll_shop",
    title: "Reroll Shop",
    description: REROLL_SHOP_DESCRIPTION,
    command: "reroll_shop",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_reroll_boss",
    title: "Reroll Boss Blind",
    description: REROLL_BOSS_DESCRIPTION,
    command: "reroll_boss",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_leave_shop",
    title: "Leave Shop",
    description: LEAVE_SHOP_DESCRIPTION,
    command: "leave_shop",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_cash_out",
    title: "Cash Out",
    description: CASH_OUT_DESCRIPTION,
    command: "cash_out",
    annotations: annotations(true, false),
    options: { timeoutMs: 18_000 },
  },
  {
    name: "balatro_skip_booster",
    title: "Skip Booster",
    description: SKIP_BOOSTER_DESCRIPTION,
    command: "skip_booster",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_restart",
    title: "Restart Run",
    description: RESTART_DESCRIPTION,
    command: "restart",
    annotations: annotations(true, false),
    options: { timeoutMs: 18_000 },
  },
  {
    name: "balatro_continue_game",
    title: "Continue Game",
    description: CONTINUE_GAME_DESCRIPTION,
    command: "continue_game",
    annotations: annotations(true, false),
    options: { timeoutMs: 18_000 },
  },
]

const CARD_ID_TOOLS: ActionTool[] = [
  {
    name: "balatro_sell_card",
    title: "Sell Card",
    description: SELL_CARD_DESCRIPTION,
    command: "sell_card",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_buy_card",
    title: "Buy Card",
    description: BUY_CARD_DESCRIPTION,
    command: "buy_card",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_buy_voucher",
    title: "Buy Voucher",
    description: BUY_VOUCHER_DESCRIPTION,
    command: "buy_voucher",
    annotations: annotations(true, false),
  },
  {
    name: "balatro_buy_booster",
    title: "Buy Booster",
    description: BUY_BOOSTER_DESCRIPTION,
    command: "buy_booster",
    annotations: annotations(true, false),
  },
]

export function registerActionTools(server: McpServer, bridge: BridgeClient): void {
  for (const tool of NO_ARG_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: emptySchema,
        outputSchema: commandOutputSchema,
        annotations: tool.annotations,
      },
      ({ instance_id }) =>
        commandWithSuccessor(bridge, tool.command, undefined, {
          ...tool.options,
          instanceId: instance_id,
        }),
    )
  }

  for (const tool of CARD_ID_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: cardIdInputSchema,
        outputSchema: commandOutputSchema,
        annotations: tool.annotations,
      },
      ({ card_id, instance_id }) =>
        commandWithSuccessor(
          bridge,
          tool.command,
          { card_id: String(card_id) },
          { instanceId: instance_id },
        ),
    )
  }

  server.registerTool(
    "balatro_select_hand_cards",
    {
      title: "Select Hand Cards",
      description: SELECT_HAND_CARDS_DESCRIPTION,
      inputSchema: selectHandSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(false, true),
    },
    ({ card_ids, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "select_hand_cards",
        { card_ids: card_ids.map(String) },
        { instanceId: instance_id, toMarkdown: handSelectionToMarkdown },
      ),
  )

  server.registerTool(
    "balatro_sort_hand",
    {
      title: "Sort Hand",
      description: SORT_HAND_DESCRIPTION,
      inputSchema: sortHandSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(false, true),
    },
    ({ order, instance_id }) =>
      commandWithSuccessor(bridge, "sort_hand", { order }, { instanceId: instance_id }),
  )

  server.registerTool(
    "balatro_reorder_hand",
    {
      title: "Reorder Hand",
      description: REORDER_HAND_DESCRIPTION,
      inputSchema: reorderHandSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(false, true),
    },
    ({ order, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "reorder_hand",
        { card_ids: order.map(String) },
        { instanceId: instance_id },
      ),
  )

  server.registerTool(
    "balatro_use_consumable",
    {
      title: "Use Consumable",
      description: USE_CONSUMABLE_DESCRIPTION,
      inputSchema: targetedCardSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(true, false),
    },
    ({ card_id, targets, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "use_consumable",
        { card_id: String(card_id), targets: targets?.map(String) },
        { instanceId: instance_id },
      ),
  )

  server.registerTool(
    "balatro_buy_consumable",
    {
      title: "Buy Consumable",
      description: BUY_CONSUMABLE_DESCRIPTION,
      inputSchema: buyConsumableSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(true, false),
    },
    ({ card_id, use, targets, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "buy_consumable",
        { card_id: String(card_id), use, targets: targets?.map(String) },
        { instanceId: instance_id },
      ),
  )

  server.registerTool(
    "balatro_select_booster_card",
    {
      title: "Select Booster Card",
      description: SELECT_BOOSTER_CARD_DESCRIPTION,
      inputSchema: targetedCardSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(true, false),
    },
    ({ card_id, targets, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "select_booster_card",
        { card_id: String(card_id), targets: targets?.map(String) },
        { instanceId: instance_id },
      ),
  )

  server.registerTool(
    "balatro_reorder_jokers",
    {
      title: "Reorder Jokers",
      description: REORDER_JOKERS_DESCRIPTION,
      inputSchema: reorderJokersSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(false, true),
    },
    ({ order, instance_id }) =>
      commandWithSuccessor(
        bridge,
        "reorder_jokers",
        { card_ids: order.map(String) },
        { instanceId: instance_id },
      ),
  )

  server.registerTool(
    "balatro_new_game",
    {
      title: "New Game",
      description: NEW_GAME_DESCRIPTION,
      inputSchema: newGameSchema,
      outputSchema: commandOutputSchema,
      annotations: annotations(true, false),
    },
    async (args) => {
      const params =
        "challenge" in args
          ? { challenge: args.challenge }
          : { deck: args.deck, stake: args.stake, seed: args.seed }
      return commandWithSuccessor(bridge, "new_game", params, {
        timeoutMs: 18_000,
        instanceId: args.instance_id,
      })
    },
  )
}
