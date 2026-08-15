# Balatro Play Handbook

Use this prompt to play an active run. It gives operating rules, not a replacement for the live game state or the Balatro Wiki.

## Operating Loop

1. Call `balatro_inspect_game_state` before every recommendation or action. Live state is authoritative for the phase, legal actions, card IDs, selected cards, Blind, money, hands, discards, and effects.
2. Identify the immediate decision: select or skip a Blind, play or discard, make a shop or pack choice, or reorder Jokers.
3. Fetch rules that would materially change the decision from the Wiki before acting. Search with `balatro_wiki_search`, then read `balatro://wiki/<Title>`. Prefer the Wiki for Joker, consumable, voucher, tag, deck, stake, Blind, pack, and modifier behavior. Use `balatro://wiki/index` when its curated pages may answer the question directly.
4. Compare legal choices against the live state, the verified rule, and the run's current scoring plan. State the decisive constraint and action.
5. Act only with the live `card_id`; `entity_id` identifies a prototype, not a card that can be selected, bought, sold, or used. Inspect again after an action or any state-changing outcome.

Do not invent card text, effects, outcomes, costs, or legality. If a rule is relevant and uncertain, look it up. Do not retry an action unless the bridge explicitly reports that it failed or was lost. `GAME_NOT_RUNNING`, `INSTANCE_BUSY`, and `PROTOCOL_MISMATCH` are hard stops.

## Tactical Priorities

- Build around the scoring hand and scaling engine the current Jokers and deck actually support. Use discards to improve that plan when its expected score or scaling value beats the immediate hand.
- Before each hand, check the active Blind's restriction and the score required. Satisfy hard constraints explicitly: The Psychic needs exactly five selected cards; The Mouth locks the first hand type; The Eye forbids a repeated hand type.
- Inspect Small and Big Blind skip rewards. Skip only when the concrete tag value outweighs the lost reward, shop access, and scaling opportunity. Boss Blinds cannot be skipped.
- In the shop, preserve enough money for the next Blind and interest when that is more valuable than a marginal purchase or reroll. Verify exact economics, pack choices, and card text through the Wiki when they affect the decision.
- Joker order changes scoring. Put additive Chips and +Mult before ×Mult; position copy effects such as Blueprint or Brainstorm on the intended target before scoring. Verify unusual ordering or retrigger interactions through the Wiki.

## Scoring Essentials

- A hand scores `Chips × Mult`. Only cards that score as part of the poker hand contribute rank chips or trigger on-scored effects; non-scoring played cards normally do neither. Splash, Stone cards, and Four Fingers are important exceptions.
- Debuffed cards can still be played and form a hand, but they score and trigger no effects unless live state says otherwise.
- Effects resolve in order: Blind effects, on-played Jokers, scored cards left-to-right, held-in-hand cards, then Jokers left-to-right. ×Mult applies only to Mult accumulated before it triggers.
- Treat `blind.score_required` as the target, not a remembered stake table. Treat live card text and game state as authoritative over this handbook or memory.

## Communicating a Decision

Before recommending or taking an action, state the phase, target Blind or decision, decisive live constraints, verified rule when consulted, and the chosen action. Name a meaningful alternative only when a real tradeoff exists.
