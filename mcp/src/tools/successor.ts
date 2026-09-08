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

const SETTLE_TIMEOUT_MS = 10_000
const SETTLE_POLL_MS = 250

interface SuccessorRule {
  uri: string
  awaitedPhases: Record<string, true>
  contextPhases: Record<string, true>
}

// Only attach context where the immediately useful resource is deterministic
// and actionable. Other commands return their command result alone.
const SUCCESSOR_RULES: Record<string, SuccessorRule> = {
  select_blind: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    contextPhases: { SELECTING_HAND: true },
  },
  play_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true, ROUND_EVAL: true, GAME_OVER: true },
    contextPhases: { SELECTING_HAND: true },
  },
  discard_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    contextPhases: { SELECTING_HAND: true },
  },
  sort_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    contextPhases: { SELECTING_HAND: true },
  },
  reorder_hand: {
    uri: "balatro://hand",
    awaitedPhases: { SELECTING_HAND: true },
    contextPhases: { SELECTING_HAND: true },
  },
  reroll_shop: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
    contextPhases: { SHOP: true },
  },
  cash_out: {
    uri: "balatro://shop",
    awaitedPhases: { SHOP: true },
    contextPhases: { SHOP: true },
  },
  buy_booster: {
    uri: "balatro://booster",
    awaitedPhases: BOOSTER_PHASES,
    contextPhases: BOOSTER_PHASES,
  },
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
  while (!rule.awaitedPhases[phase] && Date.now() < deadline) {
    await Bun.sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())))
    try {
      payload = await bridge.getState()
      phase = typeof payload.phase === "string" ? payload.phase : "UNKNOWN"
    } catch {
      return { payload, settled: false }
    }
  }
  return { payload, settled: rule.awaitedPhases[phase] === true }
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
      const envelope: Record<string, unknown> = { ok: true }
      const record = asRecord(data)
      if (record && Object.keys(record).length > 0) {
        envelope.data = record
      }
      const rule = SUCCESSOR_RULES[kind]
      if (rule === undefined) return { envelope, successor: undefined }
      const outcome = await settleState(
        bridge,
        rule,
        options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
        options.pollMs ?? SETTLE_POLL_MS,
      )
      if (outcome.payload === undefined) return { envelope, successor: undefined }
      const phase = typeof outcome.payload.phase === "string" ? outcome.payload.phase : "UNKNOWN"
      if (rule.contextPhases[phase] !== true) return { envelope, successor: undefined }
      const rendered = renderSuccessor(rule.uri, outcome.payload)
      envelope.next = {
        uri: rendered.uri,
        phase,
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
