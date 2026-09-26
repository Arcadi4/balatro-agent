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
  instanceId?: string
  pollMs?: number
}

// SMODS routes every booster through its own pseudo-state, so the vanilla pack
// phases are never entered and cannot be used to spot an open pack. The payload
// itself is the only reliable signal.
const PACK_PHASE = "SMODS_BOOSTER_OPENED"

// Phases the agent can actually decide in. Everything else, including
// HAND_PLAYED, DRAW_TO_HAND, PLAY_TAROT, ROUND_EVAL, NEW_ROUND and GAME_OVER,
// is a transition with no decision behind it.
const ACTIONABLE_PHASES: Record<string, true> = {
  SELECTING_HAND: true,
  BLIND_SELECT: true,
  SHOP: true,
}

const RUN_PHASES: Record<string, true> = {
  BLIND_SELECT: true,
  SELECTING_HAND: true,
  HAND_PLAYED: true,
  DRAW_TO_HAND: true,
  SHOP: true,
  ROUND_EVAL: true,
  GAME_OVER: true,
  [PACK_PHASE]: true,
}

const STATE_TIMEOUT_MS = 1_500
const SETTLE_TIMEOUT_MS = 10_000
const SETTLE_POLL_MS = 250

interface SuccessorRule {
  uri?: string
  awaitedPhases: Record<string, true>
  resolveUri?: (payload: Record<string, unknown>) => string | undefined
  ready?: (payload: Record<string, unknown>) => boolean
  changedField?: "hand" | "jokers"
}

function phaseOf(payload: Record<string, unknown>): string {
  return typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
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

function packOpen(payload: Record<string, unknown>): boolean {
  return asRecord(payload.pack) !== undefined
}

function boosterReady(payload: Record<string, unknown>): boolean {
  const pack = asRecord(payload.pack)
  return pack !== undefined && Array.isArray(pack.options) && pack.options.length > 0
}

function packTransitionReady(payload: Record<string, unknown>): boolean {
  return !packOpen(payload) || boosterReady(payload)
}

// Settled means the snapshot is a decision surface, not merely a phase we were
// waiting for: the agent must be able to act in it, and at least one legal
// action has to be behind that phase. An open pack counts as its own surface.
// The blind-select screen reports its phase before the panel is built, so the
// payload can look ready while select_blind is not yet legal. Legal actions are
// computed by the mod against the live UI, so they are the readiness signal.
function hasLegalAction(payload: Record<string, unknown>, action?: string): boolean {
  const actions = Array.isArray(payload.legal_actions) ? payload.legal_actions : []
  return action === undefined
    ? actions.length > 0
    : actions.some((entry) => String(entry) === action)
}

function isActionablePhase(payload: Record<string, unknown>): boolean {
  const actionable = ACTIONABLE_PHASES[phaseOf(payload)] === true || packOpen(payload)
  return actionable && hasLegalAction(payload)
}

// Attach only a new, actionable surface. Returning to an inspected parent,
// such as after closing a booster, has no successor context.
const SUCCESSOR_RULES: Record<string, SuccessorRule> = {
  select_blind: {
    // The turn resource is the only one carrying the chip target, hands and
    // discards left, the blind's debuff text and the full legal-action list.
    uri: "balatro://turn",
    awaitedPhases: { SELECTING_HAND: true },
  },
  skip_blind: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => hasLegalAction(payload, "skip_blind"),
  },
  reroll_boss: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => hasLegalAction(payload, "reroll_boss"),
  },
  play_hand: {
    awaitedPhases: { SELECTING_HAND: true, ROUND_EVAL: true, GAME_OVER: true },
    resolveUri: (payload) =>
      phaseOf(payload) === "SELECTING_HAND" ? "balatro://hand" : "balatro://turn",
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
    awaitedPhases: { [PACK_PHASE]: true },
    ready: boosterReady,
  },
  select_booster_card: {
    awaitedPhases: { [PACK_PHASE]: true, SHOP: true },
    resolveUri: (payload) => (packOpen(payload) ? "balatro://booster" : undefined),
    ready: packTransitionReady,
  },
  leave_shop: {
    uri: "balatro://ante",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => hasLegalAction(payload, "select_blind"),
  },
  new_game: {
    uri: "balatro://turn",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => hasLegalAction(payload, "select_blind"),
  },
  restart: {
    uri: "balatro://turn",
    awaitedPhases: { BLIND_SELECT: true },
    ready: (payload) => hasLegalAction(payload, "select_blind"),
  },
  continue_game: {
    awaitedPhases: RUN_PHASES,
    resolveUri: (payload) => (packOpen(payload) ? "balatro://booster" : "balatro://turn"),
    ready: packTransitionReady,
  },
  buy_card: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
  },
  buy_consumable: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
  },
  buy_voucher: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
  },
  sell_card: {
    awaitedPhases: { BLIND_SELECT: true, SELECTING_HAND: true, ROUND_EVAL: true, SHOP: true },
    resolveUri: (payload) => (phaseOf(payload) === "SHOP" ? "balatro://shop" : "balatro://turn"),
  },
  use_consumable: {
    awaitedPhases: { SELECTING_HAND: true, SHOP: true },
    resolveUri: (payload) => (phaseOf(payload) === "SHOP" ? "balatro://shop" : "balatro://turn"),
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

// Best-effort state polling: a read failure ends successor discovery without
// failing the command that already succeeded.
async function settleState(
  bridge: BridgeClient,
  rule: SuccessorRule,
  timeoutMs: number,
  pollMs: number,
  instanceId?: string,
): Promise<SettledState> {
  const deadline = Date.now() + timeoutMs
  let payload: Record<string, unknown>
  let phase: string
  try {
    payload = await bridge.getState(STATE_TIMEOUT_MS, instanceId)
    phase = phaseOf(payload)
  } catch {
    return { settled: false }
  }
  while (
    (!rule.awaitedPhases[phase] || (rule.ready !== undefined && !rule.ready(payload))) &&
    Date.now() < deadline
  ) {
    await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    try {
      payload = await bridge.getState(STATE_TIMEOUT_MS, instanceId)
      phase = phaseOf(payload)
    } catch {
      return { payload, settled: false }
    }
  }
  return {
    payload,
    settled:
      rule.awaitedPhases[phase] === true &&
      (rule.ready === undefined || rule.ready(payload)) &&
      isActionablePhase(payload),
  }
}

interface SuccessorSection {
  uri: string
  markdown: string
  settled: boolean
}

/**
 * Command errors propagate without a successor read; successful commands attach
 * the next settled decision surface.
 */
export async function commandWithSuccessor(
  bridge: BridgeClient,
  kind: string,
  args?: Record<string, unknown>,
  options: SuccessorOptions = {},
): Promise<CallToolResult> {
  return withBridgeErrors(
    async () => {
      const rule = SUCCESSOR_RULES[kind]
      const instanceId = options.instanceId ?? bridge.getSelectedInstanceId()
      let before: Record<string, unknown> | undefined
      if (rule?.changedField !== undefined) {
        try {
          before = await bridge.getState(STATE_TIMEOUT_MS, instanceId)
        } catch {
          before = undefined
        }
      }
      const data = await bridge.command(kind, args, options.timeoutMs, instanceId)
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
        instanceId,
      )
      if (outcome.payload === undefined) return { envelope, successor: undefined }
      const uri = successorUri(rule, outcome.payload, before)
      if (uri === undefined) return { envelope, successor: undefined }
      const scopedUri =
        instanceId === undefined
          ? uri
          : uri.replace("balatro://", `balatro://instances/${encodeURIComponent(instanceId)}/`)
      const rendered = renderSuccessor(scopedUri, outcome.payload)
      envelope.next = {
        uri: rendered.uri,
        phase: phaseOf(outcome.payload),
        settled: outcome.settled,
      }
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
