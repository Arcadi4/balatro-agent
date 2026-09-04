import type { McpServer } from "@modelcontextprotocol/server"
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server"

import { BridgeError, type BridgeClient } from "../bridge/socket-client.js"
import { asRecord } from "../response.js"
const STATE_TIMEOUT_MS = 1_500

const MENU_PHASES: ReadonlySet<string> = new Set(["MENU", "SPLASH", "TUTORIAL", "DEMO_CTA"])

function phaseOf(payload: Record<string, unknown>): string {
  return typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
}

function unavailable(uri: string, phase: string, message: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, message, {
    error_code: "UNAVAILABLE",
    phase,
    uri,
  })
}

interface LiveResource {
  name: string
  uri: string
  title: string
  description: string
  render: (payload: Record<string, unknown>) => string
}

function markdownContents(uri: URL, markdown: string) {
  return { contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: markdown }] }
}

export async function readLiveResource(
  bridge: BridgeClient,
  uri: URL | string,
  render: LiveResource["render"],
  cachedState?: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; markdown: string }> {
  const uriString = uri.toString()
  let payload: Record<string, unknown>
  if (cachedState !== undefined) {
    payload = cachedState
  } else {
    try {
      payload = await bridge.getState(STATE_TIMEOUT_MS)
    } catch (error) {
      if (error instanceof BridgeError) {
        throw new ProtocolError(ProtocolErrorCode.InternalError, error.message, {
          error_code: error.code,
          uri: uriString,
        })
      }
      throw error
    }
  }
  const phase = phaseOf(payload)
  if (MENU_PHASES.has(phase)) {
    throw unavailable(
      uriString,
      phase,
      "Balatro is not in a run; start or continue a game to read this resource.",
    )
  }
  return { payload, markdown: render(payload) }
}

export async function readLiveResourceUri(
  bridge: BridgeClient,
  uri: string,
  cachedState?: Record<string, unknown>,
): Promise<{ uri: string; markdown: string; state: Record<string, unknown> } | undefined> {
  const definition = LIVE_RESOURCES.find((def) => def.uri === uri)
  if (!definition) return undefined
  const result = await readLiveResource(bridge, uri, definition.render, cachedState)
  return { uri: definition.uri, markdown: result.markdown, state: result.payload }
}

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
  if (card.faced_down === true) return "Face-down card"
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
  if (card.faced_down === true) {
    return `${index}. [${String(card.card_id ?? "?")}] Face-down Joker`
  }
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
  lines.push("# Shop\n")
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
  lines.push("# Booster Pack\n")
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

function slotLabel(items: unknown, slots: unknown): string {
  const count = Array.isArray(items) ? items.length : 0
  return slots === undefined ? "" : ` (${count}/${String(slots)})`
}

function selectedCardIds(payload: Record<string, unknown>): Set<string> {
  const ids = new Set<string>()
  if (Array.isArray(payload.selected_hand_card_ids)) {
    for (const id of payload.selected_hand_card_ids) ids.add(String(id))
  }
  return ids
}

function appendHandEntries(lines: string[], payload: Record<string, unknown>): void {
  const hand = Array.isArray(payload.hand) ? payload.hand : []
  if (hand.length === 0) {
    lines.push("(empty)")
    lines.push("")
    return
  }
  const selected = selectedCardIds(payload)
  for (const entry of hand) {
    const card = asRecord(entry)
    if (!card) continue
    const marker = selected.has(String(card.card_id ?? "?")) ? " *(selected)*" : ""
    lines.push(`- ${displayHandCardLine(card)}${marker}`)
  }
  lines.push("")
}

function appendCompactEntries(lines: string[], items: unknown): void {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) {
    lines.push("(empty)")
    lines.push("")
    return
  }
  let index = 1
  for (const entry of list) {
    const card = asRecord(entry)
    if (!card) continue
    appendCompactCardLine(lines, card, index)
    index += 1
  }
  lines.push("")
}

function turnToMarkdown(payload: Record<string, unknown>): string {
  const lines: string[] = []

  lines.push("# Turn\n")

  if (payload.phase !== undefined) lines.push(`**Phase:** ${String(payload.phase)}  `)
  if (payload.ante !== undefined) lines.push(`**Ante:** ${String(payload.ante)}  `)
  if (payload.money !== undefined) lines.push(`**Money:** $${String(payload.money)}  `)
  lines.push("")

  const round = asRecord(payload.round)
  if (round) appendRoundSection(lines, round)

  if (Array.isArray(payload.legal_actions) && payload.legal_actions.length > 0) {
    lines.push("## Legal Actions\n")
    for (const action of payload.legal_actions) {
      lines.push(`- \`${String(action)}\``)
    }
    lines.push("")
  }

  lines.push("## Hand\n")
  appendHandEntries(lines, payload)

  lines.push(`## Jokers${slotLabel(payload.jokers, payload.joker_slots)}\n`)
  appendCompactEntries(lines, payload.jokers)

  lines.push(`## Consumables${slotLabel(payload.consumables, payload.consumable_slots)}\n`)
  appendCompactEntries(lines, payload.consumables)

  return lines.join("\n")
}

function handToMarkdown(payload: Record<string, unknown>): string {
  const lines: string[] = ["# Hand\n"]

  appendField(lines, "Hand Size", payload.hand_size)
  if (Array.isArray(payload.selected_hand_card_ids) && payload.selected_hand_card_ids.length > 0) {
    const ids = payload.selected_hand_card_ids.map((id) => `\`${String(id)}\``).join(", ")
    lines.push(`- **Selected:** ${ids}`)
  }
  lines.push("")

  lines.push("## Cards\n")
  appendHandEntries(lines, payload)

  return lines.join("\n")
}

function jokersToMarkdown(payload: Record<string, unknown>): string {
  const lines: string[] = [`# Jokers${slotLabel(payload.jokers, payload.joker_slots)}\n`]
  appendCompactEntries(lines, payload.jokers)
  return lines.join("\n")
}

function consumablesToMarkdown(payload: Record<string, unknown>): string {
  const lines: string[] = [
    `# Consumables${slotLabel(payload.consumables, payload.consumable_slots)}\n`,
  ]
  appendCompactEntries(lines, payload.consumables)
  return lines.join("\n")
}

function deckToMarkdown(payload: Record<string, unknown>): string {
  const deck = asRecord(payload.deck_summary)
  if (!deck) return "No deck data available."
  const lines = [
    "# Deck\n",
    "`b/e` = base/effective; `?N` = N face-down cards omitted from tallies.\n",
  ]
  appendDeckView(lines, "Remaining", deck.remaining)
  appendDeckView(lines, "Full Deck", deck.full_deck)
  return lines.join("\n")
}

function shopToMarkdown(payload: Record<string, unknown>): string {
  const shop = asRecord(payload.shop)
  if (!shop) {
    throw unavailable(
      "balatro://shop",
      phaseOf(payload),
      "The shop is not open; balatro://shop only exists during the SHOP phase.",
    )
  }
  const lines: string[] = []
  appendShopSection(lines, shop)
  return lines.join("\n")
}

function boosterToMarkdown(payload: Record<string, unknown>): string {
  const pack = asRecord(payload.pack)
  if (!pack) {
    throw unavailable(
      "balatro://booster",
      phaseOf(payload),
      "No booster pack is open; balatro://booster only exists while a pack is being opened.",
    )
  }
  const lines: string[] = []
  appendPackSection(lines, pack)
  return lines.join("\n")
}

function runToMarkdown(payload: Record<string, unknown>): string {
  const lines: string[] = []

  lines.push("# Run\n")

  appendField(lines, "Ante", payload.ante)
  if (payload.money !== undefined) lines.push(`- **Money:** $${String(payload.money)}`)
  if (typeof payload.active_challenge === "string") {
    lines.push(`- **Active Challenge:** ${payload.active_challenge}`)
  }
  if (Array.isArray(payload.disabled_entities) && payload.disabled_entities.length > 0) {
    const names = payload.disabled_entities.map((entry) => String(entry)).join(", ")
    lines.push(`- **Disabled Entities:** ${names}`)
  }
  if (payload.endless_mode === true) lines.push("- **Endless Mode:** true")
  lines.push("")

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

function anteToMarkdown(payload: Record<string, unknown>): string {
  const selection = asRecord(payload.blind_select)
  if (!selection) {
    throw unavailable(
      "balatro://ante",
      phaseOf(payload),
      "No blind overview is available for the current state.",
    )
  }

  const lines: string[] = []

  lines.push("# Ante\n")

  appendField(lines, "Ante", payload.ante)
  if (payload.endless_mode === true) lines.push("- **Endless Mode:** true")
  lines.push("")

  appendBlindSelectSection(lines, selection, payload.tags)

  return lines.join("\n")
}

function displayTally(value: unknown): string {
  const tally = asRecord(value)
  if (!tally) return "0"
  const base = String(tally.base ?? 0)
  return tally.effective !== undefined && tally.effective !== tally.base
    ? `${base}/${String(tally.effective)}`
    : base
}

const SUIT_ORDER = ["Spades", "Hearts", "Clubs", "Diamonds"] as const
const RANK_ORDER = [
  "Ace",
  "King",
  "Queen",
  "Jack",
  "10",
  "9",
  "8",
  "7",
  "6",
  "5",
  "4",
  "3",
  "2",
] as const

function orderedEntries(
  value: Record<string, unknown>,
  order: readonly string[],
): Array<[string, unknown]> {
  const positions: Record<string, number> = Object.fromEntries(
    order.map((key, index) => [key, index]),
  )
  return Object.entries(value).sort(
    ([a], [b]) =>
      (positions[a] ?? order.length) - (positions[b] ?? order.length) || a.localeCompare(b),
  )
}

function appendDeckCards(lines: string[], cards: unknown[], remainingOnly: boolean): void {
  const groups: Record<string, string[]> = {}
  let unknown = 0
  for (const value of cards) {
    const card = asRecord(value)
    if (!card || (remainingOnly && card.remaining === false)) continue
    if (card.faced_down === true) {
      unknown += 1
      continue
    }
    const suit = String(card.suit ?? "Other")
    const label = displayHandCard(card).replace(displayCardSuit(card.suit), "")
    const group = groups[suit] ?? []
    group.push(label)
    groups[suit] = group
  }
  if (Object.keys(groups).length === 0 && unknown === 0) return
  lines.push("\n### Cards\n")
  for (const [suit, cardsInSuit] of orderedEntries(groups, SUIT_ORDER)) {
    lines.push(`- ${displayCardSuit(suit)}: ${(cardsInSuit as string[]).join(", ")}`)
  }
  if (unknown > 0) lines.push(`- ?: ×${unknown}`)
}

function appendDeckView(lines: string[], title: string, value: unknown): void {
  const view = asRecord(value)
  if (!view) return
  const unknownCount = typeof view.unknown_count === "number" ? view.unknown_count : 0
  const drawPile =
    title === "Remaining" && view.draw_pile_count !== undefined
      ? ` (${String(view.draw_pile_count)} deck`
      : ""
  const unknown = unknownCount > 0 ? `${drawPile ? " + " : " ("}?${unknownCount}` : ""
  const suffix = drawPile || unknown ? `${drawPile}${unknown})` : ""
  lines.push(`## ${title} — ${String(view.count ?? 0)}${suffix}\n`)

  const tallies = asRecord(view.tallies)
  if (tallies) {
    const categories = asRecord(tallies.categories)
    if (categories) {
      const stones = String(tallies.stone_cards ?? 0)
      lines.push(
        `- **Types:** A ${displayTally(categories.aces)} · F ${displayTally(categories.face_cards)} · # ${displayTally(categories.numbered_cards)} · Stone ${stones}`,
      )
    }
    const suits = asRecord(tallies.by_suit)
    if (suits) {
      lines.push(
        `- **Suits:** ${orderedEntries(suits, SUIT_ORDER)
          .map(([suit, tally]) => `${displayCardSuit(suit)} ${displayTally(tally)}`)
          .join(" · ")}`,
      )
    }
    const ranks = asRecord(tallies.by_rank)
    if (ranks && Object.keys(ranks).length > 0) {
      lines.push(
        `- **Ranks:** ${orderedEntries(ranks, RANK_ORDER)
          .map(([rank, tally]) => `${displayCardRank(rank)} ${displayTally(tally)}`)
          .join(" · ")}`,
      )
    }
  }
  if (Array.isArray(view.cards)) appendDeckCards(lines, view.cards, title === "Remaining")
  lines.push("")
}

const LIVE_RESOURCES: LiveResource[] = [
  {
    name: "turn",
    uri: "balatro://turn",
    title: "Turn",
    description:
      "Live turn snapshot: phase, ante, money, round progress, legal actions, hand with selected cards, jokers, and consumables.",
    render: turnToMarkdown,
  },
  {
    name: "hand",
    uri: "balatro://hand",
    title: "Hand",
    description:
      "Current hand cards with card IDs, modifiers, and selection state; face-down cards are hidden.",
    render: handToMarkdown,
  },
  {
    name: "jokers",
    uri: "balatro://jokers",
    title: "Jokers",
    description:
      "Owned jokers with editions, costs, and live effect descriptions; face-down jokers are hidden.",
    render: jokersToMarkdown,
  },
  {
    name: "consumables",
    uri: "balatro://consumables",
    title: "Consumables",
    description: "Held Tarot, Planet, and Spectral cards with usability status.",
    render: consumablesToMarkdown,
  },
  {
    name: "deck",
    uri: "balatro://deck",
    title: "Deck",
    description:
      "Balatro-style Remaining and Full Deck views with base/effective rank, suit, and card-type tallies; face-down remaining cards count as unknown.",
    render: deckToMarkdown,
  },
  {
    name: "shop",
    uri: "balatro://shop",
    title: "Shop",
    description:
      "Shop contents while the shop is open: cards, vouchers, boosters, and reroll cost. Errors UNAVAILABLE outside the SHOP phase.",
    render: shopToMarkdown,
  },
  {
    name: "booster",
    uri: "balatro://booster",
    title: "Booster Pack",
    description:
      "Currently open booster pack: kind, picks remaining, and options. Errors UNAVAILABLE when no pack is open.",
    render: boosterToMarkdown,
  },
  {
    name: "run",
    uri: "balatro://run",
    title: "Run",
    description:
      "Run-level facts: ante, money, poker-hand levels with play counts, vouchers, queued tags, discard pile, challenge, disabled entities, and endless mode.",
    render: runToMarkdown,
  },
  {
    name: "ante",
    uri: "balatro://ante",
    title: "Ante",
    description:
      "Ante overview readable throughout a run: the Small, Big, and Boss blinds with chip targets, skip rewards, on-deck blind, boss reroll cost, and queued tags.",
    render: anteToMarkdown,
  },
]

export function registerLiveResources(server: McpServer, bridge: BridgeClient): void {
  for (const definition of LIVE_RESOURCES) {
    server.registerResource(
      definition.name,
      definition.uri,
      {
        title: definition.title,
        description: definition.description,
        mimeType: "text/markdown",
      },
      async (uri) => {
        const result = await readLiveResource(bridge, uri, definition.render)
        return markdownContents(uri, result.markdown)
      },
    )
  }
}
