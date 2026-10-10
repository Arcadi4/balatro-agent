import type { CallToolResult } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { autoContextEnabled } from "../flags.js"
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

const STATE_TIMEOUT_MS = 1_500
const SETTLE_TIMEOUT_MS = 10_000
const SETTLE_POLL_MS = 250

// Lua reports a surface only after its native controls are ready.
const SURFACES = {
  turn: true,
  hand: true,
  shop: true,
  booster: true,
  ante: true,
} as const
type Section = keyof typeof SURFACES

function surfaceOf(payload: Record<string, unknown>): Section | undefined {
  const surface = payload.decision_surface
  return typeof surface === "string" && SURFACES[surface as Section] === true
    ? (surface as Section)
    : undefined
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

interface SuccessorRule {
  section?: (observed: Section) => string | undefined
  changedField?: "hand" | "jokers"
}

const FOLLOW_OBSERVED: SuccessorRule = {}

const resumedRun = (observed: Section): string => (observed === "booster" ? "booster" : "turn")

const ownedCardScreen = (observed: Section): string =>
  observed === "booster" || observed === "shop" ? observed : "turn"

const SUCCESSOR_RULES: Record<string, SuccessorRule> = {
  // The turn resource is the only one carrying the chip target, hands and
  // discards left, the blind's debuff text and the full legal-action list.
  select_blind: { section: (observed) => (observed === "hand" ? "turn" : observed) },
  skip_blind: FOLLOW_OBSERVED,
  reroll_boss: FOLLOW_OBSERVED,
  new_game: { section: resumedRun },
  restart: { section: resumedRun },
  continue_game: { section: resumedRun },
  sell_card: { section: ownedCardScreen },
  use_consumable: { section: ownedCardScreen },
  // Closing a pack returns to a screen the agent already read, so only a pack
  // that is still open is worth a successor.
  select_booster_card: { section: (observed) => (observed === "booster" ? "booster" : undefined) },
  // Reordering reports a successor only when it really changed the order.
  sort_hand: { changedField: "hand" },
  reorder_hand: { changedField: "hand" },
  reorder_jokers: {
    section: (observed) => (observed === "hand" || observed === "shop" ? "jokers" : observed),
    changedField: "jokers",
  },
  leave_shop: FOLLOW_OBSERVED,
  play_hand: FOLLOW_OBSERVED,
  discard_hand: FOLLOW_OBSERVED,
  buy_booster: FOLLOW_OBSERVED,
  buy_card: FOLLOW_OBSERVED,
  buy_consumable: FOLLOW_OBSERVED,
  buy_voucher: FOLLOW_OBSERVED,
  reroll_shop: FOLLOW_OBSERVED,
  cash_out: FOLLOW_OBSERVED,
}

interface SettledState {
  payload?: Record<string, unknown>
  surface?: Section
}

// Best-effort state polling: a read failure ends successor discovery without
// failing the command that already succeeded.
async function settleState(
  bridge: BridgeClient,
  timeoutMs: number,
  pollMs: number,
  instanceId: string,
): Promise<SettledState> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let payload: Record<string, unknown>
    try {
      payload = await bridge.getState(STATE_TIMEOUT_MS, instanceId)
    } catch {
      return {}
    }
    const surface = surfaceOf(payload)
    if (surface !== undefined) return { payload, surface }
    if (Date.now() >= deadline) return {}
    await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
  }
}

interface SuccessorSection {
  uri: string
  markdown: string
}

/**
 * Command errors propagate without a successor read; successful commands attach
 * the next surface the mod reports as ready, and nothing when none arrives in
 * time. Launching with --no-auto-context drops that read entirely: the command
 * runs with no state read before it, no settle poll after it, and no next field.
 *
 * The target is resolved once, before anything is sent, and its private
 * identity then carries every read and write in the call: an instance starting
 * or stopping mid-command cannot redirect the command, the settle poll, or the
 * successor URI this result points at.
 */
export async function commandWithSuccessor(
  bridge: BridgeClient,
  kind: string,
  args?: Record<string, unknown>,
  options: SuccessorOptions = {},
): Promise<CallToolResult> {
  return withBridgeErrors(
    async () => {
      const rule = autoContextEnabled() ? SUCCESSOR_RULES[kind] : undefined
      const target = await bridge.resolveInstance(options.instanceIndex)
      await bridge.connect(target.instance)
      const instanceId = target.instance.instance_id
      let before: Record<string, unknown> | undefined
      if (rule?.changedField !== undefined) {
        try {
          before = await bridge.getState(STATE_TIMEOUT_MS, instanceId)
        } catch {
          before = undefined
        }
      }
      const data = await bridge.command(kind, args, instanceId)
      const envelope: Record<string, unknown> = { ok: true }
      const record = asRecord(data)
      if (record && Object.keys(record).length > 0) {
        envelope.data = record
      }
      if (rule === undefined) return { envelope, successor: undefined }
      const outcome = await settleState(
        bridge,
        options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
        options.pollMs ?? SETTLE_POLL_MS,
        instanceId,
      )
      if (outcome.payload === undefined || outcome.surface === undefined) {
        return { envelope, successor: undefined }
      }
      const section = rule.section === undefined ? outcome.surface : rule.section(outcome.surface)
      if (section === undefined) return { envelope, successor: undefined }
      if (
        rule.changedField !== undefined &&
        !changedCards(before, outcome.payload, rule.changedField)
      ) {
        return { envelope, successor: undefined }
      }
      // The caller-addressable form names the index it resolved, never the
      // private identity behind it.
      const rendered = renderSuccessor(
        `balatro://instances/${target.instance_index}/${section}`,
        outcome.payload,
      )
      envelope.next = {
        uri: rendered.uri,
        phase: typeof outcome.payload.phase === "string" ? outcome.payload.phase : "UNKNOWN",
      }
      const successor: SuccessorSection = {
        uri: rendered.uri,
        markdown: rendered.markdown,
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
        const lines = [base, "", "---", "", `## Next: ${successor.uri}`, "", successor.markdown]
        return lines.join("\n")
      }),
  )
}
