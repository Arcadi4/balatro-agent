import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { formatResponse } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";
import INSPECT_CARD_INSTANCE_DESCRIPTION from "./descriptions/inspect-card-instance.txt" with { type: "text" };
import INSPECT_GAME_STATE_DESCRIPTION from "./descriptions/inspect-game-state.txt" with { type: "text" };

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

const inputSchema = z.object({}).strict();

const inspectCardInstanceSchema = z
  .object({
    card_id: z
      .union([z.string(), z.number().int()])
      .describe(
        "Live card instance ID from balatro_inspect_game_state, not an entity/prototype ID.",
      ),
  })
  .strict();

const EDITION_NAMES: Record<string, string> = {
  foil: "Foil",
  holo: "Holographic",
  holographic: "Holographic",
  polychrome: "Polychrome",
  negative: "Negative",
};

function normalizeCardId(value: string | number): string {
  return String(value);
}

function cloneRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

function findInArray(
  items: unknown,
  cardId: string,
  location: string,
): Record<string, unknown> | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const record = cloneRecord(item);
    if (record && normalizeCardId(record.card_id as string | number) === cardId) {
      return { location, card: record };
    }
  }
  return null;
}

function findCardInstance(
  payload: Record<string, unknown>,
  cardId: string,
): Record<string, unknown> | null {
  const directLocations = [
    ["hand", "hand"],
    ["jokers", "jokers"],
    ["consumables", "consumables"],
  ] as const;

  for (const [field, location] of directLocations) {
    const found = findInArray(payload[field], cardId, location);
    if (found) return found;
  }

  const shop = cloneRecord(payload.shop);
  if (shop) {
    for (const field of ["jokers", "vouchers", "boosters", "cards"]) {
      const found = findInArray(shop[field], cardId, `shop.${field}`);
      if (found) return found;
    }
  }

  const pack = cloneRecord(payload.pack);
  if (pack) {
    const found = findInArray(pack.options, cardId, "pack.options");
    if (found) return found;
  }

  return null;
}

function cardInstanceToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const instance = (d.instance ?? {}) as Record<string, unknown>;
  const lines: string[] = [];

  if (isJokerCard(instance)) {
    lines.push(`# ${displayJokerName(instance)}\n`);
    lines.push(`**Location:** ${d.location}  `);
    lines.push("");
    lines.push("## Joker\n");
    lines.push(displayJokerLine(instance, 1));
    appendLiveDescription(lines, instance);
    lines.push("");
    lines.push("## Live Instance\n");
    lines.push("```json");
    lines.push(JSON.stringify(instance, null, 2));
    lines.push("```");

    return lines.join("\n");
  }

  lines.push(`# ${instance.name ?? instance.display ?? instance.card_id ?? "Card Instance"}\n`);
  lines.push(`**Location:** ${d.location}  `);
  lines.push(`**Card ID:** ${instance.card_id}  `);
  if (instance.entity_id) lines.push(`**Entity ID:** \`${instance.entity_id}\`  `);
  if (instance.sell_value !== undefined) lines.push(`**Sell Value:** $${instance.sell_value}  `);
  if (instance.cost !== undefined) lines.push(`**Cost:** $${instance.cost}  `);
  if (instance.debuffed !== undefined) lines.push(`**Debuffed:** ${instance.debuffed}  `);
  lines.push("");

  lines.push("## Live Instance\n");
  lines.push("```json");
  lines.push(JSON.stringify(instance, null, 2));
  lines.push("```");

  return lines.join("\n");
}

function displayCardRank(value: unknown): string {
  const rank = String(value ?? "?");
  const ranks: Record<string, string> = {
    Ace: "A",
    King: "K",
    Queen: "Q",
    Jack: "J",
  };
  return ranks[rank] ?? rank;
}

function displayCardSuit(value: unknown): string {
  const suit = String(value ?? "").toLowerCase();
  const suits: Record<string, string> = {
    spades: "♠",
    hearts: "♥",
    clubs: "♣",
    diamonds: "♦",
  };
  return suits[suit] ?? "?";
}

function displayCardModifier(value: unknown, names: Record<string, string>): string | undefined {
  if (value === undefined || value === null) return undefined;
  const key = String(value).toLowerCase();
  return names[key] ?? String(value);
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
  };
  const seals: Record<string, string> = {
    red: "Red Seal",
    blue: "Blue Seal",
    purple: "Purple Seal",
    gold: "Gold Seal",
  };
  const isStone = card.enhancement === "stone";
  const enhancement = isStone ? undefined : displayCardModifier(card.enhancement, enhancements);
  const seal = displayCardModifier(card.seal, seals);
  const edition = displayCardModifier(card.edition, EDITION_NAMES);
  const modifiers = [enhancement, seal, edition].filter(
    (value): value is string => value !== undefined,
  );
  if (card.debuffed !== undefined) modifiers.push("Debuffed");

  const base = isStone
    ? "Stone Card"
    : `${displayCardRank(card.rank)}${displayCardSuit(card.suit)}`;
  return modifiers.length > 0 ? `${base} (${modifiers.join(", ")})` : base;
}

function displayHandCardLine(card: Record<string, unknown>): string {
  return `[${String(card.card_id ?? "?")}] ${displayHandCard(card)}`;
}

function displayJokerName(card: Record<string, unknown>): string {
  return String(card.name ?? card.entity_id ?? card.card_id ?? "Unknown Joker");
}

function displayJokerRarity(value: unknown): string {
  if (value === undefined || value === null) return "";
  const rarity = String(value).toLowerCase();
  const stars: Record<string, string> = {
    "1": "*",
    common: "*",
    "2": "**",
    uncommon: "**",
    "3": "***",
    rare: "***",
    "4": "****",
    legendary: "****",
  };
  return stars[rarity] ?? "";
}

function displayJokerPrice(card: Record<string, unknown>): string | undefined {
  if (card.cost === undefined && card.sell_value === undefined) return undefined;
  return `$${String(card.cost ?? "?")}/$${String(card.sell_value ?? "?")}`;
}

function displayJokerLine(card: Record<string, unknown>, index: number): string {
  const rarity = displayJokerRarity(card.rarity);
  const price = displayJokerPrice(card);
  const edition = displayCardModifier(card.edition, EDITION_NAMES);
  const status = [edition, card.debuffed !== undefined ? "(x)" : undefined].filter(
    (value): value is string => value !== undefined,
  );
  const parts = [
    `${index}. [${String(card.card_id ?? "?")}]`,
    `${displayJokerName(card)}${rarity}`,
    price,
    ...status,
  ].filter((value): value is string => value !== undefined);
  return parts.join(" ");
}

function appendLiveDescription(lines: string[], card: Record<string, unknown>): void {
  const description = card.live_description ?? card.description ?? card.effect_text;
  if (description === undefined || description === null) return;
  if (Array.isArray(description)) {
    for (const line of description) {
      if (line !== undefined && line !== null) lines.push(`   ${String(line)}`);
    }
    return;
  }
  lines.push(`   ${String(description)}`);
}

function displayConsumableType(value: unknown): string {
  const kind = String(value ?? "").toLowerCase();
  const prefixes: Record<string, string> = {
    tarot: "T",
    planet: "P",
    spectral: "S",
  };
  return prefixes[kind] ?? "?";
}

function displayConsumableLine(card: Record<string, unknown>, index: number): string {
  const edition = displayCardModifier(card.edition, EDITION_NAMES);
  const suffix = edition !== undefined ? ` (${edition})` : "";
  return `${index}. [${String(card.card_id ?? "?")}] ${displayConsumableType(card.kind)} ${String(card.name ?? card.entity_id ?? "Unknown Consumable")}${suffix}`;
}

function displayConsumableSectionTitle(payload: Record<string, unknown>): string {
  const consumableCount = Array.isArray(payload.consumables) ? payload.consumables.length : 0;
  if (payload.consumable_slots === undefined) return "## Consumables\n";
  return `## Consumables (${consumableCount}/${String(payload.consumable_slots)})\n`;
}

function displayJokerSectionTitle(payload: Record<string, unknown>): string {
  const jokerCount = Array.isArray(payload.jokers) ? payload.jokers.length : 0;
  if (payload.joker_slots === undefined) return "## Jokers\n";
  return `## Jokers (${jokerCount}/${String(payload.joker_slots)})\n`;
}

function isJokerCard(card: Record<string, unknown>): boolean {
  return (
    card.kind === "joker" || (typeof card.entity_id === "string" && card.entity_id.startsWith("j_"))
  );
}

function isConsumableCard(card: Record<string, unknown>): boolean {
  return card.kind === "tarot" || card.kind === "planet" || card.kind === "spectral";
}

function displayShopCardLine(card: Record<string, unknown>): string {
  if (isJokerCard(card)) return displayJokerLine(card, 1);
  if (isConsumableCard(card)) return displayConsumableLine(card, 1);

  const label = card.name ?? card.entity_id ?? "Unknown Card";
  const details = [card.kind, displayCardModifier(card.edition, EDITION_NAMES)].filter(
    (value): value is string => value !== undefined,
  );
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  const cost = card.cost !== undefined ? ` — $${String(card.cost)}` : "";
  return `[${String(card.card_id ?? "?")}] ${String(label)}${suffix}${cost}`;
}

function displayPackCardLine(card: Record<string, unknown>): string {
  if (card.kind === "playing_card") return displayHandCardLine(card);
  if (isJokerCard(card)) return displayJokerLine(card, 1);
  if (isConsumableCard(card)) return displayConsumableLine(card, 1);

  const label = card.name ?? card.entity_id ?? "Unknown Card";
  const details = [card.kind, displayCardModifier(card.edition, EDITION_NAMES)].filter(
    (value): value is string => value !== undefined,
  );
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `[${String(card.card_id ?? "?")}] ${String(label)}${suffix}`;
}

function appendCompactCardLine(lines: string[], card: Record<string, unknown>, index: number): void {
  if (isJokerCard(card)) {
    lines.push(displayJokerLine(card, index));
    appendLiveDescription(lines, card);
    return;
  }
  if (isConsumableCard(card)) {
    lines.push(displayConsumableLine(card, index));
    appendLiveDescription(lines, card);
    return;
  }
  lines.push(`- ${displayPackCardLine(card)}`);
}

function appendShopSection(lines: string[], shop: Record<string, unknown>): void {
  lines.push("## Shop\n");
  appendField(lines, "Dollars", shop.dollars);
  appendField(lines, "Reroll Cost", shop.reroll_cost);
  appendField(lines, "Joker Slots", shop.slots);

  const sections = [
    ["Cards", shop.cards ?? shop.jokers],
    ["Vouchers", shop.vouchers],
    ["Boosters", shop.boosters],
  ] as const;

  for (const [label, items] of sections) {
    if (!Array.isArray(items) || items.length === 0) continue;
    lines.push(`\n### ${label}\n`);
    let index = 1;
    for (const item of items) {
      const card = cloneRecord(item);
      if (!card) continue;
      if (isJokerCard(card) || isConsumableCard(card)) {
        appendCompactCardLine(lines, card, index);
      } else {
        lines.push(`- ${displayShopCardLine(card)}`);
      }
      index += 1;
    }
  }

  lines.push("");
}

function appendPackSection(lines: string[], pack: Record<string, unknown>): void {
  lines.push("## Booster Pack\n");
  appendField(lines, "Kind", pack.kind);
  appendField(lines, "Picks Remaining", pack.picks_remaining);

  if (Array.isArray(pack.options) && pack.options.length > 0) {
    lines.push("\n### Options\n");
    let index = 1;
    for (const item of pack.options) {
      const card = cloneRecord(item);
      if (!card) continue;
      appendCompactCardLine(lines, card, index);
      index += 1;
    }
  }

  lines.push("");
}

function appendField(lines: string[], label: string, value: unknown): void {
  if (value !== undefined) lines.push(`- **${label}:** ${String(value)}`);
}

function appendCurrentRound(lines: string[], value: unknown): void {
  const round = cloneRecord(value);
  if (!round) {
    appendField(lines, "Round", value);
    return;
  }

  appendField(lines, "Hands Left", round.hands_left);
  appendField(lines, "Discards Left", round.discards_left);
  appendField(lines, "Hands Played", round.hands_played);
  appendField(lines, "Discards Used", round.discards_used);
  appendField(lines, "Round Dollars", round.dollars);
  appendField(lines, "Reroll Cost", round.reroll_cost);
  appendField(lines, "Free Rerolls", round.free_rerolls);
}

function displayPhase(
  payload: Record<string, unknown>,
  pack: Record<string, unknown> | null,
): string | undefined {
  const phase = payload.phase;
  if (typeof phase !== "string") return phase !== undefined ? String(phase) : undefined;
  if (!/^STATE_\d+$/.test(phase) || !pack) return phase;

  const packPhases: Record<string, string> = {
    tarot: "TAROT_PACK",
    planet: "PLANET_PACK",
    spectral: "SPECTRAL_PACK",
    standard: "STANDARD_PACK",
    buffoon: "BUFFOON_PACK",
    modded: "SMODS_BOOSTER_OPENED",
  };
  return typeof pack.kind === "string" ? (packPhases[pack.kind] ?? phase) : phase;
}

function stateToMarkdown(data: object): string {
  const payload = ((data as Record<string, unknown>).payload ?? {}) as Record<string, unknown>;
  const pack = cloneRecord(payload.pack);

  const lines: string[] = [];
  lines.push("# Balatro Game State\n");

  const phase = displayPhase(payload, pack);
  if (phase) lines.push(`**Phase:** ${phase}  `);
  if (payload.g_state) lines.push(`**G.STATE:** ${String(payload.g_state)}  `);
  if (payload.money !== undefined) lines.push(`**Money:** $${payload.money}  `);
  lines.push("");

  if (payload.ante !== undefined || payload.current_round !== undefined) {
    lines.push("## Round Info\n");
    appendField(lines, "Ante", payload.ante);
    appendCurrentRound(lines, payload.current_round);
    lines.push("");
  }

  if (payload.blind && typeof payload.blind === "object") {
    const blind = payload.blind as Record<string, unknown>;
    lines.push("## Blind\n");
    if (blind.name) lines.push(`- **Name:** ${blind.name}`);
    if (blind.chips !== undefined) lines.push(`- **Target Chips:** ${blind.chips}`);
    if (blind.chips_scored !== undefined) lines.push(`- **Chips Scored:** ${blind.chips_scored}`);
    lines.push("");
  }

  if (Array.isArray(payload.legal_actions) && payload.legal_actions.length > 0) {
    lines.push("## Legal Actions\n");
    for (const action of payload.legal_actions) {
      lines.push(`- \`${String(action)}\``);
    }
    lines.push("");
  }

  if (Array.isArray(payload.hand) && payload.hand.length > 0) {
    lines.push("## Hand\n");
    for (const card of payload.hand) {
      const c = card as Record<string, unknown>;
      lines.push(`- ${displayHandCardLine(c)}`);
    }
    lines.push("");
  }

  if (
    (Array.isArray(payload.jokers) && payload.jokers.length > 0) ||
    payload.joker_slots !== undefined
  ) {
    lines.push(displayJokerSectionTitle(payload));
    let index = 1;
    if (Array.isArray(payload.jokers)) {
      for (const j of payload.jokers) {
        const joker = cloneRecord(j);
        if (!joker) continue;
        appendCompactCardLine(lines, joker, index);
        index += 1;
      }
    }
    lines.push("");
  }

  if (
    (Array.isArray(payload.consumables) && payload.consumables.length > 0) ||
    payload.consumable_slots !== undefined
  ) {
    lines.push(displayConsumableSectionTitle(payload));
    let index = 1;
    if (Array.isArray(payload.consumables)) {
      for (const c of payload.consumables) {
        const consumable = cloneRecord(c);
        if (!consumable) continue;
        appendCompactCardLine(lines, consumable, index);
        index += 1;
      }
    }
    lines.push("");
  }

  const shop = cloneRecord(payload.shop);
  if (shop) appendShopSection(lines, shop);

  if (pack) appendPackSection(lines, pack);

  return lines.join("\n");
}

export function registerInspectGameState(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_inspect_game_state",
    {
      description: INSPECT_GAME_STATE_DESCRIPTION,
      inputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      let state;
      try {
        state = await deps.bridgeClient.getState({ maxAgeMs: 1500 });
      } catch (err) {
        if (err instanceof BridgeError) {
          const envelope = toolError(err.code, err.message);
          return { ...envelope };
        }
        throw err;
      }

      const payload = cloneRecord(state.payload) ?? {};
      const structured: Record<string, unknown> = {
        payload,
      };

      const envelope = formatResponse(structured, {
        toMarkdown: stateToMarkdown,
      });
      return { ...envelope };
    },
  );

  server.registerTool(
    "balatro_inspect_card_instance",
    {
      description: INSPECT_CARD_INSTANCE_DESCRIPTION,
      inputSchema: inspectCardInstanceSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) => {
      const cardId = normalizeCardId(args.card_id);

      let state;
      try {
        state = await deps.bridgeClient.getState({ maxAgeMs: 1500 });
      } catch (err) {
        if (err instanceof BridgeError) {
          const envelope = toolError(err.code, err.message);
          return { ...envelope };
        }
        throw err;
      }

      const payload = cloneRecord(state.payload) ?? {};
      const found = findCardInstance(payload, cardId);
      if (!found) {
        return {
          ...toolError("INVALID_TARGET", `card_id "${cardId}" not found in current live state`),
        };
      }

      const instance = cloneRecord(found.card) ?? (found.card as Record<string, unknown>);
      const structured: Record<string, unknown> = {
        card_id: cardId,
        location: found.location,
        instance,
      };

      const envelope = formatResponse(structured, {
        toMarkdown: cardInstanceToMarkdown,
      });
      return { ...envelope };
    },
  );
}
