import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { asRecord, asText, toolErrorSchema, type MarkdownFormatter } from "../response.js"
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

const INSTANCE_INDEX_DESCRIPTION =
  "Index of the live Balatro instance to act on, as listed by balatro://instances. " +
  "Omit it when exactly one instance is running; with several running an omitted index " +
  "fails with INSTANCE_SELECTION_REQUIRED, so read balatro://instances and pass the index " +
  "you want. Indices are recomputed on every discovery and shift when instances start or " +
  "stop, so re-read the list before acting much later in a session. Actions connect on " +
  "demand: calling connect first is optional."

const instanceIndexSchema = z.number().int().min(0).optional().describe(INSTANCE_INDEX_DESCRIPTION)
export const instanceIndexInputSchema = z.object({ instance_index: instanceIndexSchema }).strict()
const cardIdSchema = z
  .union([z.string().min(1), z.number().int()])
  .describe("Card ID from game state.")
const cardIdInputSchema = z
  .object({ card_id: cardIdSchema, instance_index: instanceIndexSchema })
  .strict()
const targetsSchema = z
  .array(cardIdSchema)
  .max(50)
  .refine((cardIds) => new Set(cardIds.map(String)).size === cardIds.length, {
    message: "targets must not contain duplicates",
  })
  .optional()
  .describe("Target hand card IDs; required for hand-targeting consumables.")
const targetedCardSchema = z
  .object({ card_id: cardIdSchema, targets: targetsSchema, instance_index: instanceIndexSchema })
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
    instance_index: instanceIndexSchema,
  })
  .strict()
const sortHandSchema = z
  .object({
    order: z.enum(["rank", "suit"]).describe("Sort by rank or suit."),
    instance_index: instanceIndexSchema,
  })
  .strict()
const reorderHandSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .max(50)
      .describe("Every current hand card ID exactly once, in the desired left-to-right order."),
    instance_index: instanceIndexSchema,
  })
  .strict()
const reorderJokersSchema = z
  .object({
    order: z
      .array(cardIdSchema)
      .max(50)
      .describe("Every current joker card ID exactly once, in the desired left-to-right order."),
    instance_index: instanceIndexSchema,
  })
  .strict()
const buyConsumableSchema = z
  .object({
    card_id: cardIdSchema,
    use: z.boolean().describe("Apply the consumable immediately instead of storing it."),
    targets: targetsSchema.describe("Target hand card IDs; only valid together with use=true."),
    instance_index: instanceIndexSchema,
  })
  .strict()
  // The mod rejects targets without use, so fail here with the field at fault.
  .refine(({ targets, use }) => targets === undefined || use, {
    message: "targets is only valid when use=true",
    path: ["targets"],
  })
const normalRunSchema = z
  .object({
    deck: z.string().min(1).describe("Deck key (e.g. b_red, b_blue)."),
    stake: z.number().int().min(1).max(8).describe("Stake difficulty, 1-8."),
    seed: z.string().min(1).optional().describe("Seed for a seeded run."),
    instance_index: instanceIndexSchema,
  })
  .strict()
const challengeRunSchema = z
  .object({
    challenge: z.string().min(1).describe("Challenge id (e.g. c_omelette_1)."),
    instance_index: instanceIndexSchema,
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
  })
  .strict()
const commandSuccessSchema = z
  .object({ ok: z.literal(true), data: z.unknown().optional(), next: successorSchema.optional() })
  .strict()
const commandOutputSchema = z.union([commandSuccessSchema, toolErrorSchema])

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
    `- **Cards played:** ${asText(data.cards_played ?? "unknown")}`,
  ]
  if (data.hand_name !== undefined) {
    const level = data.hand_level !== undefined ? ` (level ${asText(data.hand_level)})` : ""
    lines.push(`- **Hand:** ${asText(data.hand_name)}${level}`)
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
      lines.push(`  - ${asText(card.rank ?? "?")} of ${asText(card.suit ?? "?")}${suffix}`)
    }
  }
  if (data.hand_chips !== undefined || data.hand_mult !== undefined) {
    const chips = data.hand_chips !== undefined ? `${asText(data.hand_chips)} chips` : "?"
    const mult = data.hand_mult !== undefined ? `${asText(data.hand_mult)} mult` : "?"
    lines.push(`- **Hand scoring:** ${chips} x ${mult}`)
  }
  if (data.chip_total !== undefined) {
    lines.push(`- **Hand score:** ${asText(data.chip_total)}`)
  }
  if (data.points_gained !== undefined)
    lines.push(`- **Points gained:** ${asText(data.points_gained)}`)
  if (data.score_before !== undefined && data.score_after !== undefined) {
    lines.push(`- **Score:** ${asText(data.score_before)} -> ${asText(data.score_after)}`)
  }
  if (data.blind_chips !== undefined) lines.push(`- **Blind target:** ${asText(data.blind_chips)}`)
  if (data.blind_defeated !== undefined) {
    lines.push(`- **Blind defeated:** ${asText(data.blind_defeated)}`)
  }
  if (data.hands_played_before !== undefined && data.hands_played_after !== undefined) {
    lines.push(
      `- **Hands played:** ${asText(data.hands_played_before)} -> ${asText(data.hands_played_after)}`,
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
  const level = data.hand_level !== undefined ? ` (level ${asText(data.hand_level)})` : ""
  const lines = [`Selected ${asText(data.selected ?? "?")} cards as ${asText(name)}${level}.`]
  if (data.hand_chips !== undefined || data.hand_mult !== undefined) {
    const chips = data.hand_chips !== undefined ? `${asText(data.hand_chips)} chips` : "?"
    const mult = data.hand_mult !== undefined ? `${asText(data.hand_mult)} mult` : "?"
    lines.push(`Base scoring: ${chips} x ${mult}, before card chips, jokers and blind effects.`)
  }
  return lines.join("\n")
}

interface ActionInvocation {
  args?: Record<string, unknown>
  instanceIndex?: number
  toMarkdown?: MarkdownFormatter
}

interface ActionConfig<C extends string, S extends z.ZodType> {
  command: C
  title: string
  description: string
  inputSchema: S
  annotations: ToolAnnotations
  toInvocation: (input: z.output<S>) => ActionInvocation
}

export interface GameAction<C extends string = string, S extends z.ZodType = z.ZodType> {
  readonly command: C
  readonly title: string
  readonly description: string
  readonly inputSchema: S
  readonly outputSchema: typeof commandOutputSchema
  readonly annotations: ToolAnnotations
  /** Runs the action with no successor read, for the CLI. */
  execute(bridge: BridgeClient, raw: unknown): Promise<CallToolResult>
  /** Registers the MCP tool, which keeps the auto-context flag behavior. */
  register(server: McpServer, bridge: BridgeClient): void
}

function invokeAction<C extends string, S extends z.ZodType>(
  config: ActionConfig<C, S>,
  input: z.output<S>,
  bridge: BridgeClient,
  successor: boolean,
): Promise<CallToolResult> {
  const invocation = config.toInvocation(input)
  return commandWithSuccessor(bridge, config.command, invocation.args, {
    instanceIndex: invocation.instanceIndex,
    toMarkdown: invocation.toMarkdown,
    ...(successor ? {} : { successor: false }),
  })
}

/**
 * The same Zod schema viewed through the SDK's Standard Schema interface with
 * its input and output types preserved. The SDK validates a call once with this
 * schema before invoking the handler, so the handler's argument is already
 * `z.output<S>` and parsing it again would only repeat that work.
 */
type ValidatedInputSchema<S extends z.ZodType> = StandardSchemaWithJSON<z.input<S>, z.output<S>>

// Pairs one validator and wire adapter with both entry points: MCP registration
// keeps the successor feed, while execute runs a single action with no state read.
function defineAction<const C extends string, S extends z.ZodType>(
  config: ActionConfig<C, S>,
): GameAction<C, S> {
  return {
    command: config.command,
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: commandOutputSchema,
    annotations: config.annotations,
    execute: async (bridge, raw) =>
      invokeAction(config, config.inputSchema.parse(raw), bridge, false),
    register: (server, bridge) => {
      // The SDK validates the call with this schema and hands the handler the
      // parsed output, so the handler must not parse the same input again.
      const inputSchema = config.inputSchema as ValidatedInputSchema<S>
      server.registerTool(
        `balatro_${config.command}`,
        {
          title: config.title,
          description: config.description,
          inputSchema,
          outputSchema: commandOutputSchema,
          annotations: config.annotations,
        },
        async (input) => invokeAction(config, input, bridge, true),
      )
    },
  }
}

// Registration order is also catalog order: MCP lists these tools exactly as
// before, and the CLI can iterate them without a second table.
export const gameActions = [
  defineAction({
    command: "select_blind",
    title: "Select Blind",
    description: SELECT_BLIND_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "skip_blind",
    title: "Skip Blind",
    description: SKIP_BLIND_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "play_hand",
    title: "Play Hand",
    description: PLAY_HAND_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({
      instanceIndex: instance_index,
      toMarkdown: playHandToMarkdown,
    }),
  }),
  defineAction({
    command: "discard_hand",
    title: "Discard Hand",
    description: DISCARD_HAND_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "reroll_shop",
    title: "Reroll Shop",
    description: REROLL_SHOP_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "reroll_boss",
    title: "Reroll Boss Blind",
    description: REROLL_BOSS_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "leave_shop",
    title: "Leave Shop",
    description: LEAVE_SHOP_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "cash_out",
    title: "Cash Out",
    description: CASH_OUT_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "skip_booster",
    title: "Skip Booster",
    description: SKIP_BOOSTER_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "restart",
    title: "Restart Run",
    description: RESTART_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "continue_game",
    title: "Continue Game",
    description: CONTINUE_GAME_DESCRIPTION,
    inputSchema: instanceIndexInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ instance_index }) => ({ instanceIndex: instance_index }),
  }),
  defineAction({
    command: "sell_card",
    title: "Sell Card",
    description: SELL_CARD_DESCRIPTION,
    inputSchema: cardIdInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, instance_index }) => ({
      args: { card_id: String(card_id) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "buy_card",
    title: "Buy Card",
    description: BUY_CARD_DESCRIPTION,
    inputSchema: cardIdInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, instance_index }) => ({
      args: { card_id: String(card_id) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "buy_voucher",
    title: "Buy Voucher",
    description: BUY_VOUCHER_DESCRIPTION,
    inputSchema: cardIdInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, instance_index }) => ({
      args: { card_id: String(card_id) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "buy_booster",
    title: "Buy Booster",
    description: BUY_BOOSTER_DESCRIPTION,
    inputSchema: cardIdInputSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, instance_index }) => ({
      args: { card_id: String(card_id) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "select_hand_cards",
    title: "Select Hand Cards",
    description: SELECT_HAND_CARDS_DESCRIPTION,
    inputSchema: selectHandSchema,
    annotations: annotations(false, true),
    toInvocation: ({ card_ids, instance_index }) => ({
      args: { card_ids: card_ids.map(String) },
      instanceIndex: instance_index,
      toMarkdown: handSelectionToMarkdown,
    }),
  }),
  defineAction({
    command: "sort_hand",
    title: "Sort Hand",
    description: SORT_HAND_DESCRIPTION,
    inputSchema: sortHandSchema,
    annotations: annotations(false, true),
    toInvocation: ({ order, instance_index }) => ({
      args: { order },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "reorder_hand",
    title: "Reorder Hand",
    description: REORDER_HAND_DESCRIPTION,
    inputSchema: reorderHandSchema,
    annotations: annotations(false, true),
    toInvocation: ({ order, instance_index }) => ({
      args: { card_ids: order.map(String) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "use_consumable",
    title: "Use Consumable",
    description: USE_CONSUMABLE_DESCRIPTION,
    inputSchema: targetedCardSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, targets, instance_index }) => ({
      args: { card_id: String(card_id), targets: targets?.map(String) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "buy_consumable",
    title: "Buy Consumable",
    description: BUY_CONSUMABLE_DESCRIPTION,
    inputSchema: buyConsumableSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, use, targets, instance_index }) => ({
      args: { card_id: String(card_id), use, targets: targets?.map(String) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "select_booster_card",
    title: "Select Booster Card",
    description: SELECT_BOOSTER_CARD_DESCRIPTION,
    inputSchema: targetedCardSchema,
    annotations: annotations(true, false),
    toInvocation: ({ card_id, targets, instance_index }) => ({
      args: { card_id: String(card_id), targets: targets?.map(String) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "reorder_jokers",
    title: "Reorder Jokers",
    description: REORDER_JOKERS_DESCRIPTION,
    inputSchema: reorderJokersSchema,
    annotations: annotations(false, true),
    toInvocation: ({ order, instance_index }) => ({
      args: { card_ids: order.map(String) },
      instanceIndex: instance_index,
    }),
  }),
  defineAction({
    command: "new_game",
    title: "New Game",
    description: NEW_GAME_DESCRIPTION,
    inputSchema: newGameSchema,
    annotations: annotations(true, false),
    toInvocation: (input) => ({
      args:
        "challenge" in input
          ? { challenge: input.challenge }
          : { deck: input.deck, stake: input.stake, seed: input.seed },
      instanceIndex: input.instance_index,
    }),
  }),
]

export function registerActionTools(server: McpServer, bridge: BridgeClient): void {
  for (const action of gameActions) action.register(server, bridge)
}
