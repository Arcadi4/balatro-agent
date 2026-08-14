# Tested OpenCode Agent Prompts

This directory preserves four iterations of an OpenCode agent prompt developed
through repeated live Balatro runs on Windows. The prompts are examples, not a
replacement for `balatro_strategy_context`, and are not loaded by the MCP server
automatically.

Each file keeps the OpenCode front matter used by that historical variant. The
`model` field records the original test configuration; users can remove it or
override the model in OpenCode without changing the prompt body.

## Variants

| Version | Snapshot | Main change | Best retained evidence |
| --- | --- | --- | --- |
| v1 | 2026-07-19 | Baseline autonomous loop and tool discipline | DeepSeek V4 Flash reached an Ante 8 shop on Green Deck / White Stake before provider quota exhaustion |
| v2 | 2026-07-23 | Lower-throughput shop, replacement, and ordering discipline | No retained exported run suitable for a result claim |
| v3 | 2026-07-23 | Concise discard, scoring-card, ordering, and stop discipline | DeepSeek V4 Flash reached Ante 7 on Blue Deck / White Stake |
| v4 | 2026-07-24 | Deck-building goals, discard budget, score pace, and stable tool use | DeepSeek V4 Flash autonomously defeated the Ante 8 Boss on Red Deck / White Stake and entered Ante 9 |

The aggregate evidence is recorded in
[`evaluation-summary.json`](./evaluation-summary.json). It intentionally omits
raw conversations, model reasoning, session/message/call IDs, local paths, and
credentials.

## Evidence limits

- These were live exploratory runs, not a controlled benchmark. Seeds, decks,
  stakes, models, and user interaction were not held constant.
- Reaching Ante 8 is not counted as a win. Only v4 has retained evidence of the
  agent defeating the Ante 8 Boss without a human taking over the final fight.
- The v1 export identifies the `ds-balatro-flash` agent but does not embed its
  prompt body. `balatro-v1-2026-07-19.md` is the closest preserved pre-Campfire
  snapshot, so it is marked as recovered rather than byte-exact.
- The v4 file is the preserved snapshot used for the successful run. Later
  local edits to the active v4 prompt are not included here.
- Provider quota exhaustion ended the retained v1 session at an Ante 8 shop.
  The result is reported as quota-limited, not as an autonomous clear.

## Local performance observation

Long OpenCode sessions produced visible Balatro frame drops on the Windows test
machine. The successful v4 run lasted about 86 minutes, and persistent slow-frame
logging began when its context reached roughly 90,674 tokens. Several later
sessions also became progressively slower around Ante 5 or later. Closing
OpenCode removed the visible lag in the observed case.

This is a single-machine observation, not a confirmed cross-platform defect.
The available evidence does not isolate the cause to the prompt, OpenCode's
long-session context/TUI, the MCP bridge, or the game mod. Faster observed runs
did not clear Ante 8, but the sample is too small and uncontrolled to infer that
slower play improves win rate.

## Using a variant

Copy one file into an OpenCode agent directory or adapt its body to another MCP
client. Keep only one variant active for a run so conflicting strategy rules do
not compete for context. Start the game and MCP bridge first, then ask the agent
to play one run autonomously.

For comparisons, record at least the prompt version, model, seed, deck, stake,
final Ante/phase, whether a human intervened, and whether the stop came from the
game, provider quota, or a bridge error.
