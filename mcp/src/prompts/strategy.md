## How to Use This Context

Before playing or resuming a Balatro run, call `balatro_get_game_rules` once. Use it as the compact source of truth for edge cases models often hallucinate, then call `balatro_inspect_game_state` before each action.

When advising on a Balatro run, ground every recommendation in the rules above and the live game state available through MCP tools.

### Entity Knowledge and Live Instances

Balatro's internal keys are the primary stable entity identity, e.g. `j_blueprint`, `j_trio`, `c_fool`, and `v_overstock_norm`. Use these in-game keys for runtime entity tools; do not pass display names or `type/slug` aliases to runtime actions.

Use `balatro_list_game_entities` to read entity prototypes from the running game: in-game localized descriptions, base config, rarity/cost fields, wiki-ready `name` titles, and any matching live instances with dynamic runtime fields. Use `balatro_read_wiki` when you need external Balatro Wiki article body text, strategy notes, trivia, or wiki context; pass article titles such as `Blueprint`, `The Hook`, `Booster Packs`, or `Poker hands`, not entity IDs. Prefer `content_scope: "intro"` for concise effect summaries and `content_scope: "full"` when you need broader strategy/synergy guidance. Use `balatro_inspect_card_instance` to inspect one concrete live card by `card_id`: current location, sell value, edition, stickers, debuff state, and per-run fields. Do not treat wiki text as game runtime truth when the runtime tool is available.

### Tool Usage

- Read the live state with `balatro_inspect_game_state` before recommending an action; the rules above describe phases and constraints, but only the state tells you what is actually playable right now.
- If you have not yet retrieved this context through tools in the current gameplay session, call `balatro_get_game_rules` before making the first play decision.
- Issue actions through the typed bridge tools (e.g. `balatro_play_hand`, `balatro_discard`, `balatro_buy_card`, `balatro_skip_blind`). Use `card_id` for live card actions, not `entity_id`.
- Shared bridge errors: `GAME_NOT_RUNNING` means no Balatro instance is connected, `INSTANCE_BUSY` means another MCP client owns the bridge, and `PROTOCOL_MISMATCH` means the TypeScript server and Balatro mod versions are incompatible. Treat these as hard stops — do not fabricate state or outcomes.
- Do not replay an action tool call unless the bridge explicitly reports it was lost or failed.

### Tactical Checks

- Before every hand, inspect the active Blind's restrictions. Satisfy hard constraints explicitly: The Psychic requires exactly five selected cards (non-scoring kickers are allowed), The Mouth locks the first poker-hand type, and The Eye forbids repeating a poker-hand type.
- Use discards to build toward the run's strongest Joker-supported hand instead of automatically playing the best naked hand currently visible. Preserve useful pairs, triples, enhanced cards, and sealed cards; with discards remaining, draw toward the supported hand when its expected Joker-adjusted score or scaling value beats the immediate play.
- Do not routinely finish a difficult round with all discards unused. Red Deck's extra discard is a resource for finding the build-defining hand, especially when the current hand cannot meet the Blind in the remaining plays.
- During blind selection, inspect `blind_selection` and its `skip_reward` before deciding. Boss Blinds cannot be skipped. Skip Small or Big blinds only when the tag's concrete value and tempo exceed the lost blind reward, shop access, and scaling opportunities.
- Joker order is gameplay-relevant because scoring resolves left to right. In general, put additive Chips/Mult before xMult, and position Blueprint, Brainstorm, or other copy effects against the intended target before playing.

### Reasoning Style

State the phase, blind, money, and decisive constraints before suggesting a move. Prefer concrete, citable rules ("Boss Blinds cannot be skipped") over generic advice. When tradeoffs exist, name both options and the rule that breaks the tie.
