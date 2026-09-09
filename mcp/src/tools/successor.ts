import type { CallToolResult } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { renderSuccessor } from "../resources/live.js"
import {
  asRecord,
  defaultMarkdown,
  toolResult,
  withBridgeErrors,
  type CommandResultOptions,
} from "../response.js"

export interface SuccessorOptions extends CommandResultOptions {
  settleTimeoutMs?: number
  pollMs?: number
}

const BOOSTER_PHASES: Record<string, true> = {
  TAROT_PACK: true,
  PLANET_PACK: true,
  SPECTRAL_PACK: true,
  STANDARD_PACK: true,
  BUFFOON_PACK: true,
  SMODS_BOOSTER_OPENED: true,
}

const RUN_PHASES: Record<string, true> = {
  BLIND_SELECT: true,
  SELECTING_HAND: true,
  HAND_PLAYED: true,
  DRAW_TO_HAND: true,
  SHOP: true,
  ROUND_EVAL: true,
  GAME_OVER: true,
  ...BOOSTER_PHASES,
}

const SETTLE_TIMEOUT_MS = 10_000
const SETTLE_POLL_MS = 250

interface SuccessorRule {
  uri?: string
  awaitedPhases: Record<string, true>
  resolveUri?: (payload: Record<string, unknown>) => string | undefined
  ready?: (payload: Record<string, unknown>) => boolean
  changedField?: "hand" | "jokers"
}

function changedCards(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  field: "hand" | "jokers",
): boolean {
  if (before === undefined) return true
  const beforeCards = Array.isArray(before[field]) ? before[field] : []
  const afterCards = Array.isArray(after[field]) ? after[field] : []
  if (beforeCards.length !== afterCards.length) return true
  return beforeCards.some((value, index) => {
    const beforeCard = asRecord(value)
    const afterCard = asRecord(afterCards[index])
    return String(beforeCard?.card_id ?? "") !== String(afterCard?.card_id ?? "")
  })
}

function shopReady(payload: Record<string, unknown>): boolean {
  const shop = asRecord(payload.shop)
  if (shop === undefined) return false
  return (
    (Array.isArray(shop.cards) && shop.cards.length > 0) ||
    (Array.isArray(shop.vouchers) && shop.vouchers.length > 0) ||
    (Array.isArray(shop.boosters) && shop.boosters.length > 0)
  )
}

function boosterReady(payload: Record<string, unknown>): boolean {
  const pack = asRecord(payload.pack)
  return pack !== undefined && Array.isArray(pack.options) && pack.options.length > 0
}

function packTransitionReady(payload: Record<string, unknown>): boolean {
  const phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
  return BOOSTER_PHASES[phase] !== true || boosterReady(payload)
}

// Attach only the next decision surface that is both new and actionable.
// Returning to a previously inspected parent surface, such as closing a
// booster, deliberately has no successor context.
const SUCCESSOR_RULES: Record<string, SuccessorRule> = {
  select_blind: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
  },
  skip_blind: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => asRecord(payload.blind_select) !== undefined,
  },
  reroll_boss: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => asRecord(payload.blind_select) !== undefined,
  },
  play_hand: {
    awaitedPhases: { SELECTING_HAND: true, ROUND_EVAL: true, GAME_OVER: true },
    resolveUri: (payload) => {
      const phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
      return phase === "SELECTING_HAND" ? "balatro://hand" : "balatro://turn"
    },
  },
  discard_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
  },
  sort_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    changedField: "hand",
  },
  reorder_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    changedField: "hand",
  },
  reroll_shop: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
    ready: shopReady,
  },
  cash_out: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
    ready: shopReady,
  },
  buy_booster: {
    uri: "balatro://booster",
    awaitedPhases: BOOSTER_PHASES,
    ready: boosterReady,
  },
  select_booster_card: {
    awaitedPhases: { ...BOOSTER_PHASES, SHOP: true },
    resolveUri: (payload) => {
      const phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
      return BOOSTER_PHASES[phase] === true ? "balatro://booster" : undefined
    },
    ready: packTransitionReady,
  },
  leave_shop: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => asRecord(payload.blind_select) !== undefined,
  },
  new_game: {
    uri: "balatro://turn",
    awaitedPhases: { BLIND_SELECT: true },
  },
  restart: {
    uri: "balatro://turn",
    awaitedPhases: { BLIND_SELECT: true },
  },
  continue_game: {
    awaitedPhases: RUN_PHASES,
    resolveUri: (payload) => {
      const phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
      return BOOSTER_PHASES[phase] === true ? "balatro://booster" : "balatro://turn"
    },
    ready: packTransitionReady,
  },
  buy_card: {
    uri: "balatro://turn",
    awaitedPhases: { SHOP: true },
  },
  buy_consumable: {
    uri: "balatro://turn",
    awaitedPhases: { SHOP: true },
  },
  buy_voucher: {
    uri: "balatro://run",
    awaitedPhases: { SHOP: true },
  },
  sell_card: {
    uri: "balatro://turn",
    awaitedPhases: { BLIND_SELECT: true, SELECTING_HAND: true, ROUND_EVAL: true, SHOP: true },
  },
  use_consumable: {
    uri: "balatro://turn",
    awaitedPhases: { SELECTING_HAND: true, SHOP: true },
  },
  reorder_jokers: {
    uri: "balatro://jokers",
    awaitedPhases: { SELECTING_HAND: true, SHOP: true },
    changedField: "jokers",
  },
}

function successorUri(
  rule: SuccessorRule,
  payload: Record<string, unknown>,
  before: Record<string, unknown> | undefined,
): string | undefined {
  if (rule.ready !== undefined && !rule.ready(payload)) return undefined
  if (rule.changedField !== undefined && !changedCards(before, payload, rule.changedField)) {
    return undefined
  }
  return rule.resolveUri?.(payload) ?? rule.uri
}

interface SettledState {
  payload?: Record<string, unknown>
  settled: boolean
}

// Polls getState until a retained successor rule's target phase is observed,
// or the budget runs out. Never throws: a missing successor must not fail a
// command that already succeeded.
async function settleState(
  bridge: BridgeClient,
  rule: SuccessorRule,
  timeoutMs: number,
  pollMs: number,
): Promise<SettledState> {
  const deadline = Date.now() + timeoutMs
  let payload: Record<string, unknown>
  let phase: string
  try {
    payload = await bridge.getState()
    phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
  } catch {
    return { settled: false }
  }
  while (
    (!rule.awaitedPhases[phase] || (rule.ready !== undefined && !rule.ready(payload))) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    try {
      payload = await bridge.getState()
      phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
    } catch {
      return { payload, settled: false }
    }
  }
  return {
    payload,
    settled:
      rule.awaitedPhases[phase] === true && (rule.ready === undefined || rule.ready(payload)),
  }
}

interface SuccessorSection {
  uri: string
  markdown: string
  settled: boolean
}

// Runs a mutating command, then attaches the settled next-step context to
// the result. Command errors propagate unchanged with no successor read.
export async function commandWithSuccessor(
  bridge: BridgeClient,
  kind: string,
  args?: Record<string, unknown>,
  options: SuccessorOptions = {},
): Promise<CallToolResult> {
  return withBridgeErrors(
    async () => {
      const rule = SUCCESSOR_RULES[kind]
      let before: Record<string, unknown> | undefined
      if (rule?.changedField !== undefined) {
        try {
          before = await bridge.getState()
        } catch {
          before = undefined
        }
      }
      const data = await bridge.command(kind, args, options.timeoutMs)
      const envelope: Record<string, unknown> = { ok: true }
      const record = asRecord(data)
      if (record && Object.keys(record).length > 0) {
        envelope.data = record
      }
      if (rule === undefined) return { envelope, successor: undefined }
      const outcome = await settleState(
        bridge,
        rule,
        options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
        options.pollMs ?? SETTLE_POLL_MS,
      )
      if (outcome.payload === undefined) return { envelope, successor: undefined }
      const uri = successorUri(rule, outcome.payload, before)
      if (uri === undefined) return { envelope, successor: undefined }
      const rendered = renderSuccessor(uri, outcome.payload)
      const phase = typeof outcome.payload.phase === "string" ? outcome.payload.phase : "UNKNOWN"
      envelope.next = { uri: rendered.uri, phase, settled: outcome.settled }
      const successor: SuccessorSection = {
        uri: rendered.uri,
        markdown: rendered.markdown,
        settled: outcome.settled,
      }
      return { envelope, successor }
    },
    ({
      envelope,
      successor,
    }: {
      envelope: Record<string, unknown>
      successor?: SuccessorSection
    }) =>
      toolResult(envelope, (result) => {
        const formatBase = options.toMarkdown ?? defaultMarkdown
        const base = formatBase(result)
        if (successor === undefined) return base
        const lines = [base, "", "---", "", `## Next: ${successor.uri}`, ""]
        if (!successor.settled) {
          lines.push(
            "*The game was still animating when this context was captured; re-read the resource if it looks stale.*",
            "",
          )
        }
        lines.push(successor.markdown)
        return lines.join("\n")
      }),
  )
}
