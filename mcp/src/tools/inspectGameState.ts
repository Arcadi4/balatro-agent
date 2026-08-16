import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { asRecord, toolResult, withBridgeErrors } from "../response.js"
import INSPECT_DECK_DESCRIPTION from "./descriptions/inspect-deck.txt" with { type: "text" }
import INSPECT_GAME_STATE_DESCRIPTION from "./descriptions/inspect-game-state.txt" with { type: "text" }
import INSPECT_RUN_INFO_DESCRIPTION from "./descriptions/inspect-run-info.txt" with { type: "text" }

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const inputSchema = z.object({}).strict()
const recordSchema = z.record(z.string(), z.unknown())
const gameStateOutputSchema = z.object({ payload: recordSchema }).strict()

const EDITION_NAMES: Record<string, string> = {
  foil: "Foil",
  holo: "Holographic",
  holographic: "Holographic",
  polychrome: "Polychrome",
  negative: "Negative",
}

function displayCardRank(value: unknown): string {
  const rank = String(value ?? "?")
  const ranks: Record<string, string> = {
    Ace: "A",
    King: "K",
    Queen: "Q",
    Jack: "J",
  }
  return ranks[rank] ?? rank
}

function displayCardSuit(value: unknown): string {
  const suit = String(value ?? "").toLowerCase()
  const suits: Record<string, string> = {
    spades: "♠",
    hearts: "♥",
    clubs: "♣",
    diamonds: "♦",
  }
  return suits[suit] ?? "?"
}

function displayCardModifier(value: unknown, names: Record<string, string>): string | undefined {
  if (value === undefined || value === null) return undefined
  const key = String(value).toLowerCase()
  return names[key] ?? String(value)
}

function displayHandCard(card: Record<string, unknown>): string {
  const enhancements: Record<string, string> = {
    bonus: "Bonus",
    mult: "Mult",
    wild: "Wild",
    glass: "Glass",
    steel: "Steel",
    stone: "Stone",
    gold: "Gold",
    lucky: "Lucky",
  }
  const seals: Record<string, string> = {
    red: "Red Seal",
    blue: "Blue Seal",
    purple: "Purple Seal",
    gold: "Gold Seal",
  }
  const isStone = card.enhancement === "stone"
  const enhancement = isStone ? undefined : displayCardModifier(card.enhancement, enhancements)
  const seal = displayCardModifier(card.seal, seals)
  const edition = displayCardModifier(card.edition, EDITION_NAMES)
  const modifiers = [enhancement, seal, edition].filter(
    (value): value is string => value !== undefined,
  )
  if (card.debuffed !== undefined) modifiers.push("Debuffed")

  const base = isStone ? "Stone Card" : `${displayCardRank(card.rank)}${displayCardSuit(card.suit)}`
  return modifiers.length > 0 ? `${base} (${modifiers.join(", ")})` : base
}

function displayHandCardLine(card: Record<string, unknown>): string {
  return `[${String(card.card_id ?? "?")}] ${displayHandCard(card)}`
}

function displayJokerName(card: Record<string, unknown>): string {
  return String(card.name ?? card.entity_id ?? card.card_id ?? "Unknown Joker")
}

function displayJokerRarity(value: unknown): string {
  if (value === undefined || value === null) return ""
  const rarity = String(value).toLowerCase()
  const stars: Record<string, string> = {
    "1": "*",
    common: "*",
    "2": "**",
    uncommon: "**",
    "3": "***",
    rare: "***",
    "4": "****",
    legendary: "****",
  }
  return stars[rarity] ?? ""
}

function displayJokerPrice(card: Record<string, unknown>): string | undefined {
  if (card.cost === undefined && card.sell_value === undefined) return undefined
  return `$${String(card.cost ?? "?")}/$${String(card.sell_value ?? "?")}`
}

function displayJokerLine(card: Record<string, unknown>, index: number): string {
  const rarity = displayJokerRarity(card.rarity)
  const price = displayJokerPrice(card)
  const edition = displayCardModifier(card.edition, EDITION_NAMES)
  const status = [
    edition,
    card.debuffed !== undefined ? "(x)" : undefined,
    card.active === true ? "(active)" : undefined,
  ].filter((value): value is string => value !== undefined)
  const parts = [
    `${index}. [${String(card.card_id ?? "?")}]`,
    `${displayJokerName(card)}${rarity}`,
    price,
    ...status,
  ].filter((value): value is string => value !== undefined)
  return parts.join(" ")
}

function appendLiveDescription(lines: string[], card: Record<string, unknown>): void {
  const description = card.live_description ?? card.description ?? card.effect_text
  if (description === undefined || description === null) return
  if (Array.isArray(description)) {
    for (const line of description) {
      if (line !== undefined && line !== null) lines.push(`   ${String(line)}`)
    }
    return
  }
  lines.push(`   ${String(description)}`)
}

function displayConsumableType(value: unknown): string {
  const kind = String(value ?? "").toLowerCase()
  const prefixes: Record<string, string> = {
    tarot: "T",
    planet: "P",
    spectral: "S",
  }
  return prefixes[kind] ?? "?"
}

function displayConsumableLine(card: Record<string, unknown>, index: number): string {
  const edition = displayCardModifier(card.edition, EDITION_NAMES)
  const status = [
    edition !== undefined ? `(${edition})` : undefined,
    card.usable === false ? "(unusable)" : undefined,
  ].filter((value): value is string => value !== undefined)
  const suffix = status.length > 0 ? " " + status.join(" ") : ""
  return `${index}. [${String(card.card_id ?? "?")}] ${displayConsumableType(card.kind)} ${String(card.name ?? card.entity_id ?? "Unknown Consumable")}${suffix}`
}

function displayConsumableSectionTitle(payload: Record<string, unknown>): string {
  const consumableCount = Array.isArray(payload.consumables) ? payload.consumables.length : 0
  if (payload.consumable_slots === undefined) return "## Consumables\n"
  return `## Consumables (${consumableCount}/${String(payload.consumable_slots)})\n`
}

function displayJokerSectionTitle(payload: Record<string, unknown>): string {
  const jokerCount = Array.isArray(payload.jokers) ? payload.jokers.length : 0
  if (payload.joker_slots === undefined) return "## Jokers\n"
  return `## Jokers (${jokerCount}/${String(payload.joker_slots)})\n`
}

function isJokerCard(card: Record<string, unknown>): boolean {
  return (
    card.kind === "joker" || (typeof card.entity_id === "string" && card.entity_id.startsWith("j_"))
  )
}

function isConsumableCard(card: Record<string, unknown>): boolean {
  return card.kind === "tarot" || card.kind === "planet" || card.kind === "spectral"
}

function displayShopCardLine(card: Record<string, unknown>): string {
  if (isJokerCard(card)) return displayJokerLine(card, 1)
  if (isConsumableCard(card)) return displayConsumableLine(card, 1)
  if (card.kind === "playing_card") {
    const cost = card.cost !== undefined ? ` — $${String(card.cost)}` : ""
    return `${displayHandCardLine(card)}${cost}`
  }

  const label = card.name ?? card.entity_id ?? "Unknown Card"
  const details = [card.kind, displayCardModifier(card.edition, EDITION_NAMES)].filter(
    (value): value is string => value !== undefined,
  )
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : ""
  const cost = card.cost !== undefined ? ` — $${String(card.cost)}` : ""
  return `[${String(card.card_id ?? "?")}] ${String(label)}${suffix}${cost}`
}

function displayPackCardLine(card: Record<string, unknown>): string {
  if (card.kind === "playing_card") return displayHandCardLine(card)
  if (isJokerCard(card)) return displayJokerLine(card, 1)
  if (isConsumableCard(card)) return displayConsumableLine(card, 1)

  const label = card.name ?? card.entity_id ?? "Unknown Card"
  const details = [card.kind, displayCardModifier(card.edition, EDITION_NAMES)].filter(
    (value): value is string => value !== undefined,
  )
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : ""
  return `[${String(card.card_id ?? "?")}] ${String(label)}${suffix}`
}

function appendCompactCardLine(
  lines: string[],
  card: Record<string, unknown>,
  index: number,
): void {
  if (isJokerCard(card)) {
    lines.push(displayJokerLine(card, index))
    appendLiveDescription(lines, card)
    return
  }
  if (isConsumableCard(card)) {
    lines.push(displayConsumableLine(card, index))
    appendLiveDescription(lines, card)
    return
  }
  lines.push(`- ${displayPackCardLine(card)}`)
}

function appendShopSection(lines: string[], shop: Record<string, unknown>): void {
  lines.push("## Shop\n")
  appendField(lines, "Dollars", shop.dollars)
  appendField(lines, "Reroll Cost", shop.reroll_cost)
  appendField(lines, "Free Rerolls", shop.free_rerolls)
  appendField(lines, "Joker Slots", shop.slots)

  const sections = [
    ["Cards", shop.cards ?? shop.jokers],
    ["Vouchers", shop.vouchers],
    ["Boosters", shop.boosters],
  ] as const

  for (const [label, items] of sections) {
    if (!Array.isArray(items) || items.length === 0) continue
    lines.push(`\n### ${label}\n`)
    let index = 1
    for (const item of items) {
      const card = asRecord(item)
      if (!card) continue
      if (isJokerCard(card) || isConsumableCard(card)) {
        appendCompactCardLine(lines, card, index)
      } else {
        lines.push(`- ${displayShopCardLine(card)}`)
      }
      index += 1
    }
  }

  lines.push("")
}

function appendPackSection(lines: string[], pack: Record<string, unknown>): void {
  lines.push("## Booster Pack\n")
  appendField(lines, "Kind", pack.kind)
  appendField(lines, "Picks Remaining", pack.picks_remaining)

  if (Array.isArray(pack.options) && pack.options.length > 0) {
    lines.push("\n### Options\n")
    let index = 1
    for (const item of pack.options) {
      const card = asRecord(item)
      if (!card) continue
      appendCompactCardLine(lines, card, index)
      index += 1
    }
  }

  lines.push("")
}

function appendField(lines: string[], label: string, value: unknown): void {
  if (value !== undefined) lines.push(`- **${label}:** ${String(value)}`)
}

function appendRoundSection(lines: string[], round: Record<string, unknown>): void {
  lines.push("## Round\n")

  const blind = asRecord(round.blind)
  if (blind) {
    const scored =
      round.chips_scored !== undefined && blind.chips !== undefined
        ? `${String(round.chips_scored)} / `
        : ""
    const target = blind.chips !== undefined ? ` — ${scored}${String(blind.chips)} chips` : ""
    lines.push(`- **Blind:** ${String(blind.name ?? "?")}${target}`)
    if (blind.description !== undefined) lines.push(`  - ${String(blind.description)}`)
  }
  appendField(lines, "Hands Left", round.hands_left)
  appendField(lines, "Discards Left", round.discards_left)
  appendField(lines, "Hands Played", round.hands_played)
  appendField(lines, "Discards Used", round.discards_used)
  appendField(lines, "Round Dollars", round.dollars)
  lines.push("")
}

function displaySkipReward(reward: Record<string, unknown>): string {
  const name = String(reward.name ?? reward.entity_id ?? "?")
  if (reward.dollars !== undefined) return `${name} (+$${String(reward.dollars)})`
  if (reward.poker_hand !== undefined) return `${name} (upgrade ${String(reward.poker_hand)})`
  return name
}

function appendBlindSelectSection(
  lines: string[],
  selection: Record<string, unknown>,
  tags: unknown,
): void {
  lines.push("## Blind Select\n")

  if (Array.isArray(selection.blinds)) {
    for (const entry of selection.blinds) {
      const blind = asRecord(entry)
      if (!blind) continue
      const chips = blind.chips !== undefined ? ` — ${String(blind.chips)} chips` : ""
      const markers: string[] = []
      if (typeof blind.state === "string" && blind.state !== "Select") {
        markers.push(blind.state.toLowerCase())
      }
      if (selection.current !== undefined && selection.current === blind.slot) {
        markers.push("on deck")
      }
      const markerText = markers.length > 0 ? ` (${markers.join(", ")})` : ""
      const reward = asRecord(blind.skip_reward)
      const skip = reward ? ` — skip: ${displaySkipReward(reward)}` : ""
      lines.push(
        `- **${String(blind.name ?? blind.blind_id ?? "?")}** (${String(blind.slot ?? "?")})${chips}${skip}${markerText}`,
      )
      if (blind.description !== undefined) lines.push(`  - ${String(blind.description)}`)
    }
  }
  if (selection.boss_reroll_cost !== undefined) {
    lines.push(`\n- **Boss reroll:** $${String(selection.boss_reroll_cost)}`)
  }

  if (Array.isArray(tags) && tags.length > 0) {
    lines.push("\n### Queued Tags\n")
    for (const entry of tags) {
      const tag = asRecord(entry)
      if (tag) lines.push(`- ${String(tag.name ?? tag.entity_id ?? "?")}`)
    }
  }
  lines.push("")
}

function stateToMarkdown(data: object): string {
  const payload = ((data as Record<string, unknown>).payload ?? {}) as Record<string, unknown>

  const lines: string[] = []
  lines.push("# Balatro Game State\n")

  if (payload.phase !== undefined) lines.push(`**Phase:** ${String(payload.phase)}  `)
  if (payload.ante !== undefined) lines.push(`**Ante:** ${String(payload.ante)}  `)
  if (payload.money !== undefined) lines.push(`**Money:** $${String(payload.money)}  `)
  lines.push("")

  const round = asRecord(payload.round)
  if (round) appendRoundSection(lines, round)

  const blindSelect = asRecord(payload.blind_select)
  if (blindSelect) appendBlindSelectSection(lines, blindSelect, payload.tags)

  if (Array.isArray(payload.legal_actions) && payload.legal_actions.length > 0) {
    lines.push("## Legal Actions\n")
    for (const action of payload.legal_actions) {
      lines.push(`- \`${String(action)}\``)
    }
    lines.push("")
  }

  if (Array.isArray(payload.hand) && payload.hand.length > 0) {
    lines.push("## Hand\n")
    for (const card of payload.hand) {
      const c = card as Record<string, unknown>
      lines.push(`- ${displayHandCardLine(c)}`)
    }
    lines.push("")
  }

  if (
    (Array.isArray(payload.jokers) && payload.jokers.length > 0) ||
    payload.joker_slots !== undefined
  ) {
    lines.push(displayJokerSectionTitle(payload))
    let index = 1
    if (Array.isArray(payload.jokers)) {
      for (const j of payload.jokers) {
        const joker = asRecord(j)
        if (!joker) continue
        appendCompactCardLine(lines, joker, index)
        index += 1
      }
    }
    lines.push("")
  }

  if (
    (Array.isArray(payload.consumables) && payload.consumables.length > 0) ||
    payload.consumable_slots !== undefined
  ) {
    lines.push(displayConsumableSectionTitle(payload))
    let index = 1
    if (Array.isArray(payload.consumables)) {
      for (const c of payload.consumables) {
        const consumable = asRecord(c)
        if (!consumable) continue
        appendCompactCardLine(lines, consumable, index)
        index += 1
      }
    }
    lines.push("")
  }

  const shop = asRecord(payload.shop)
  if (shop) appendShopSection(lines, shop)

  const pack = asRecord(payload.pack)
  if (pack) appendPackSection(lines, pack)

  return lines.join("\n")
}

function statLines(value: unknown): string[] {
  const obj = asRecord(value)
  if (!obj) return []
  const entries = Object.entries(obj).filter(([, count]) => count !== undefined && count !== null)
  if (entries.length === 0) return []
  return entries.map(([key, count]) => `- ${key}: ${String(count)}`)
}

function deckToMarkdown(data: Record<string, unknown>): string {
  const payload = (data.payload ?? {}) as Record<string, unknown>
  const deck = asRecord(payload.deck_summary)
  if (!deck) return "No deck data available."
  const lines: string[] = []
  lines.push("# Deck\n")
  lines.push(`**Total cards:** ${String(deck.count ?? 0)}  `)
  lines.push("")

  const sections: ReadonlyArray<readonly [string, unknown]> = [
    ["By Rank", deck.by_rank],
    ["By Suit", deck.by_suit],
    ["By Enhancement", deck.by_enhancement],
    ["By Seal", deck.by_seal],
    ["By Edition", deck.by_edition],
  ]
  for (const [title, field] of sections) {
    const stats = statLines(field)
    if (stats.length > 0) {
      lines.push(`## ${title}\n`)
      lines.push(...stats)
      lines.push("")
    }
  }

  if (Array.isArray(deck.cards) && deck.cards.length > 0) {
    lines.push("## Cards\n")
    for (const card of deck.cards) {
      const record = asRecord(card)
      if (record) lines.push(`- ${displayHandCard(record)}`)
    }
  }

  return lines.join("\n")
}

function runInfoToMarkdown(data: Record<string, unknown>): string {
  const payload = (data.payload ?? {}) as Record<string, unknown>
  const lines: string[] = []
  lines.push("# Run Info\n")

  if (Array.isArray(payload.hand_levels) && payload.hand_levels.length > 0) {
    lines.push("## Hand Levels\n")
    for (const entry of payload.hand_levels) {
      const level = asRecord(entry)
      if (!level) continue
      const played = level.played !== undefined ? ` — played ${String(level.played)}x` : ""
      lines.push(
        `- **${String(level.name ?? "?")}**: Lv.${String(level.level ?? "?")} — ${String(level.chips ?? "?")} chips × ${String(level.mult ?? "?")} mult${played}`,
      )
    }
    lines.push("")
  }

  if (Array.isArray(payload.used_vouchers) && payload.used_vouchers.length > 0) {
    lines.push("## Vouchers\n")
    for (const voucher of payload.used_vouchers) lines.push(`- \`${String(voucher)}\``)
    lines.push("")
  }

  if (Array.isArray(payload.tags) && payload.tags.length > 0) {
    lines.push("## Tags\n")
    for (const entry of payload.tags) {
      const tag = asRecord(entry)
      if (tag) lines.push(`- ${String(tag.name ?? tag.entity_id ?? "?")}`)
    }
    lines.push("")
  }

  const discard = asRecord(payload.discard_summary)
  if (discard) {
    lines.push(`## Discard Pile (${String(discard.count ?? 0)})\n`)
    if (Array.isArray(discard.cards) && discard.cards.length > 0) {
      for (const card of discard.cards) {
        const record = asRecord(card)
        if (record) lines.push(`- ${displayHandCard(record)}`)
      }
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd() + "\n"
}

export function registerInspectGameState(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "balatro_inspect_game_state",
    {
      title: "Inspect Game State",
      description: INSPECT_GAME_STATE_DESCRIPTION,
      inputSchema,
      outputSchema: gameStateOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      withBridgeErrors(
        () => bridge.getState(1_500),
        (payload) => toolResult({ payload }, stateToMarkdown),
      ),
  )

  server.registerTool(
    "balatro_inspect_deck",
    {
      title: "Inspect Deck",
      description: INSPECT_DECK_DESCRIPTION,
      inputSchema,
      outputSchema: gameStateOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      withBridgeErrors(
        () => bridge.getState(1_500),
        (payload) => toolResult({ payload }, deckToMarkdown),
      ),
  )

  server.registerTool(
    "balatro_inspect_run_info",
    {
      title: "Inspect Run Info",
      description: INSPECT_RUN_INFO_DESCRIPTION,
      inputSchema,
      outputSchema: gameStateOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      withBridgeErrors(
        () => bridge.getState(1_500),
        (payload) => toolResult({ payload }, runInfoToMarkdown),
      ),
  )
}
