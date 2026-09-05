import type { CallToolResult } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { renderSuccessor } from "../resources/live.js"
import {
  defaultMarkdown,
  toolResult,
  withBridgeErrors,
  type CommandResultOptions,
} from "../response.js"

export interface SuccessorOptions extends CommandResultOptions {
  settleTimeoutMs?: number
  pollMs?: number
}

// Phases that only exist while G.E_MANAGER animations resolve across ticks.
// A resting game is never observed here, so polling past them is settling,
// not guessing.
const TRANSIENT_PHASES: Record<string, true> = {
  HAND_PLAYED: true,
  DRAW_TO_HAND: true,
  NEW_ROUND: true,
}

const PACK_PHASES: Record<string, true> = {
  TAROT_PACK: true,
  PLANET_PACK: true,
  SPECTRAL_PACK: true,
  STANDARD_PACK: true,
  BUFFOON_PACK: true,
  SMODS_BOOSTER_OPENED: true,
}

const SETTLE_TIMEOUT_MS = 10_000
const SETTLE_POLL_MS = 250

// Target phases per command. The hook waits until the observed phase joins
// the set instead of trusting any resting phase: ROUND_EVAL is stable, but
// on the cash_out path it is only a stopover before SHOP. Commands without
// an entry (restart, continue_game, new_game) land in no single phase, so
// they settle past animation transients instead.
const AWAIT_PHASES: Record<string, Record<string, true>> = {
  select_blind: { SELECTING_HAND: true },
  skip_blind: { BLIND_SELECT: true },
  play_hand: { SELECTING_HAND: true, ROUND_EVAL: true, GAME_OVER: true },
  discard_hand: { SELECTING_HAND: true },
  use_consumable: { SELECTING_HAND: true, SHOP: true },
  sell_card: { BLIND_SELECT: true, SELECTING_HAND: true, ROUND_EVAL: true, SHOP: true },
  buy_card: { SHOP: true },
  buy_consumable: { SHOP: true },
  buy_voucher: { SHOP: true },
  reroll_shop: { SHOP: true },
  reroll_boss: { BLIND_SELECT: true },
  leave_shop: { BLIND_SELECT: true },
  cash_out: { SHOP: true },
  buy_booster: {
    TAROT_PACK: true,
    PLANET_PACK: true,
    SPECTRAL_PACK: true,
    STANDARD_PACK: true,
    BUFFOON_PACK: true,
    SMODS_BOOSTER_OPENED: true,
  },
  select_booster_card: {
    TAROT_PACK: true,
    PLANET_PACK: true,
    SPECTRAL_PACK: true,
    STANDARD_PACK: true,
    BUFFOON_PACK: true,
    SMODS_BOOSTER_OPENED: true,
    SHOP: true,
  },
  skip_booster: { SHOP: true },
  select_hand_cards: { SELECTING_HAND: true },
  sort_hand: { SELECTING_HAND: true },
  reorder_jokers: { SELECTING_HAND: true, SHOP: true },
}

function phaseOf(payload: Record<string, unknown>): string {
  return typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
}

// Deterministic next decision for an observed post-action phase. Phases
// without a dedicated resource (ROUND_EVAL, GAME_OVER, menu states) fall
// back to balatro://turn, which is a superset of the per-section reads.
export function resolveSuccessorUri(payload: Record<string, unknown>): string {
  const phase = phaseOf(payload)
  if (phase === "SHOP") return "balatro://shop"
  if (phase === "SELECTING_HAND" || TRANSIENT_PHASES[phase] === true) return "balatro://hand"
  if (phase === "BLIND_SELECT") return "balatro://ante"
  if (PACK_PHASES[phase] === true) return "balatro://booster"
  return "balatro://turn"
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

interface SettledState {
  payload?: Record<string, unknown>
  settled: boolean
}

// Polls getState until the observed phase joins the command's target set,
// or the budget runs out. Commands without a target set settle past
// animation transients. Never throws: a missing successor must not fail a
// command that already succeeded.
async function settleState(
  bridge: BridgeClient,
  kind: string,
  timeoutMs: number,
  pollMs: number,
): Promise<SettledState> {
  const awaited = AWAIT_PHASES[kind]
  const isSettled = (phase: string): boolean =>
    awaited !== undefined ? awaited[phase] === true : TRANSIENT_PHASES[phase] !== true
  const deadline = Date.now() + timeoutMs
  let payload: Record<string, unknown>
  try {
    payload = await bridge.getState()
  } catch {
    return { settled: false }
  }
  while (!isSettled(phaseOf(payload)) && Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    try {
      payload = await bridge.getState()
    } catch {
      return { payload, settled: false }
    }
  }
  return { payload, settled: isSettled(phaseOf(payload)) }
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
      const data = await bridge.command(kind, args, options.timeoutMs)
      const envelope: Record<string, unknown> = { ok: true, data: data ?? {} }
      const outcome = await settleState(
        bridge,
        kind,
        options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
        options.pollMs ?? SETTLE_POLL_MS,
      )
      if (outcome.payload === undefined) return { envelope, successor: undefined }
      const rendered = renderSuccessor(resolveSuccessorUri(outcome.payload), outcome.payload)
      envelope.next = {
        uri: rendered.uri,
        phase: phaseOf(outcome.payload),
        settled: outcome.settled,
        state: outcome.payload,
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
