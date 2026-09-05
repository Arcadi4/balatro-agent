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

const emptySchema = z.object({}).strict()
const cardIdSchema = z
  .union([z.string().min(1), z.number().int()])
  .describe("Card ID from game state.")
const cardIdInputSchema = z.object({ card_id: cardIdSchema }).strict()
const targetsSchema = z
  .array(cardIdSchema)
  .max(50)
  .refine((cardIds) => new Set(cardIds.map(String)).size === cardIds.length, {
    message: "targets must not contain duplicates",
  })
  .optional()
  .describe("Target card IDs for effects that act on hand cards.")
const targetedCardSchema = z.object({ card_id: cardIdSchema, targets: targetsSchema }).strict()
const selectHandSchema = z
  .object({
    card_ids: z
      .array(cardIdSchema)
      .max(50)
      .refine((cardIds) => new Set(cardIds.map(String)).size === cardIds.length, {
        message: "card_ids must not contain duplicates",
      })
      .describe("Hand card IDs to highlight. Empty array clears selection."),
  })
  .strict()
const sortHandSchema = z
  .object({
    order: z.enum(["rank", "suit"]).describe("Sort by rank or suit."),
  })
  .strict()
const reorderJokersSchema = z
  .object({
    order: z.array(cardIdSchema).max(50).describe("Joker card IDs in desired left-to-right order."),
  })
  .strict()
const buyConsumableSchema = z
  .object({
    card_id: cardIdSchema,
    use: z.boolean().describe("Apply the consumable immediately instead of storing it."),
    targets: targetsSchema,
  })
  .strict()
const newGameSchema = z
  .object({
    deck: z.string().min(1).optional().describe("Deck key (e.g. b_red, b_blue)."),
    stake: z.number().int().min(1).max(8).optional().describe("Stake difficulty, 1-8."),
    seed: z.string().min(1).optional().describe("Seed for a seeded run."),
    challenge: z.string().min(1).optional().describe("Challenge id (e.g. c_omelette_1)."),
  })
  .strict()
const successorSchema = z
  .object({
    uri: z.string(),
    phase: z.string(),
    settled: z.boolean(),
    state: z.unknown(),
  })
  .strict()
const commandOutputSchema = z
  .object({ ok: z.literal(true), data: z.unknown(), next: successorSchema.optional() })
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
  if (data.points_gained !== undefined) lines.push(`- **Points gained:** ${data.points_gained}`)
  if (data.score_before !== undefined && data.score_after !== undefined) {
    lines.push(`- **Score:** ${data.score_before} -> ${data.score_after}`)
  }
  if (data.blind_chips !== undefined) lines.push(`- **Blind target:** ${data.blind_chips}`)
  if (data.blind_defeated !== undefined) {
    lines.push(`- **Blind defeated:** ${data.blind_defeated}`)
  }
  if (data.hands_played_before !== undefined && data.hands_played_after !== undefined) {
    lines.push(`- **Hands played:** ${data.hands_played_before} -> ${data.hands_played_after}`)
  }
  if (data.timed_out) {
    lines.push("- **Warning:** scoring timed out; values reflect the latest game state.")
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
  },
  {
    name: "balatro_continue_game",
    title: "Continue Game",
    description: CONTINUE_GAME_DESCRIPTION,
    command: "continue_game",
    annotations: annotations(true, false),
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
      () => commandWithSuccessor(bridge, tool.command, undefined, tool.options),
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
      ({ card_id }) => commandWithSuccessor(bridge, tool.command, { card_id: String(card_id) }),
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
    ({ card_ids }) =>
      commandWithSuccessor(bridge, "select_hand_cards", { card_ids: card_ids.map(String) }),
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
    ({ order }) => commandWithSuccessor(bridge, "sort_hand", { order }),
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
    ({ card_id, targets }) =>
      commandWithSuccessor(bridge, "use_consumable", {
        card_id: String(card_id),
        targets: targets?.map(String),
      }),
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
    ({ card_id, use, targets }) =>
      commandWithSuccessor(bridge, "buy_consumable", {
        card_id: String(card_id),
        use,
        targets: targets?.map(String),
      }),
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
    ({ card_id, targets }) =>
      commandWithSuccessor(bridge, "select_booster_card", {
        card_id: String(card_id),
        targets: targets?.map(String),
      }),
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
    ({ order }) => commandWithSuccessor(bridge, "reorder_jokers", { card_ids: order.map(String) }),
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
    ({ deck, stake, seed, challenge }) =>
      commandWithSuccessor(bridge, "new_game", { deck, stake, seed, challenge }),
  )
}
