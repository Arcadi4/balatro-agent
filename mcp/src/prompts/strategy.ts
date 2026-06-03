/**
 * Strategy context prompt: registers the argsless `balatro_strategy_context`
 * prompt that returns the global rules markdown plus a short instruction
 * block on canonical IDs and tool usage. Independent of the bridge.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getRulesContent,
  getRulesVersion,
  getRulesLastUpdated,
} from "../resources/rules.js";

const PROMPT_NAME = "balatro_strategy_context";

const INSTRUCTION_BLOCK = `## How to Use This Context

When advising on a Balatro run, ground every recommendation in the rules
above and the live game state available through MCP tools.

### Entity Knowledge and Live Instances

Every Balatro entity (joker, tarot, planet, voucher, deck, blind, tag,
booster, enhancement, edition, seal, stake, poker_hand, sticker, challenge,
achievement) has a stable canonical ID of the form \`<type>/<name_segment>\`,
e.g. \`joker/blueprint\`, \`joker/trio\`, \`tarot/fool\`, \`voucher/overstock\`.
The name segment is derived from the game's internal key with the raw prefix
removed (\`j_trio\` → \`joker/trio\`). Wiki/display names are aliases, not the
primary identity.

Use \`balatro_read_entity_wiki\` to read static entity knowledge: effect text,
wiki/source metadata, base config, rarity, and aliases. Use
\`balatro_inspect_card_instance\` to read one live card instance by \`card_id\`:
current location, sell value, edition, stickers, debuff state, and dynamic
runtime fields. Do not infer effects from names; resolve unfamiliar Jokers via
the wiki/entity tool before making scoring claims.

### Tool Usage

- Read the live state with \`balatro_inspect_game_state\` before recommending an
  action; the rules above describe phases and constraints, but only the
  state tells you what is actually playable right now.
- Issue actions through the typed bridge tools (e.g. \`balatro_play_hand\`,
  \`balatro_discard\`, \`balatro_buy_card\`, \`balatro_skip_blind\`). Use
  \`card_id\` for live card actions, not \`entity_id\`.
- Tools return \`GAME_NOT_RUNNING\` when no Balatro instance is connected.
  Treat that as a hard stop — do not fabricate state or outcomes.
- Tools are idempotent on the seq number; never replay a command unless the
  bridge explicitly reports it was lost.

### Reasoning Style

State the phase, blind, money, and decisive constraints before suggesting a
move. Prefer concrete, citable rules ("Boss Blinds cannot be skipped") over
generic advice. When tradeoffs exist, name both options and the rule that
breaks the tie.`;

export function registerStrategyPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: "Balatro Strategy Context",
      description:
        "Loads the global rules reference and instructions on canonical IDs and tool usage for advising on Balatro runs.",
    },
    () => ({
      description: `Balatro strategy context (rules version ${getRulesVersion()}, updated ${getRulesLastUpdated()})`,
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${getRulesContent()}\n\n---\n\n${INSTRUCTION_BLOCK}`,
          },
        },
      ],
    }),
  );
}
