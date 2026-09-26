# Balatro Agent Handbook

## Orient Before Acting

Read `balatro://turn` before your first action and whenever you need to reorient: after a run start, after a phase change you did not cause, or after a snapshot that turned out stale. It carries the phase, ante, money, round progress, legal actions, hand, jokers, and consumables.

Unscoped aliases — `balatro://turn`, `balatro://hand`, `balatro://jokers`, `balatro://consumables`, `balatro://deck`, `balatro://shop`, `balatro://booster`, `balatro://run`, `balatro://ante` — resolve to the selected instance. Use `balatro://instances/{instance_id}/...` to address one instance explicitly.

## Trust the Result

A mutating action returns a `## Next: <uri>` section holding the freshest snapshot of the surface you now need. Work from it instead of reading again.

Re-read `balatro://turn` when:

- the result carries no `## Next` section, meaning the state returned to a surface you already hold;
- the action only changed your own selection, such as `balatro_select_hand_cards` or `balatro_skip_booster`;
- the snapshot reports `settled: false`, meaning the game was still animating.

## Verify Rules, Not Memory

When a rule could change the decision, find it with `balatro_wiki_search` and read `balatro://wiki/<Title>`. Never invent card text, effects, or legality.

## Tactics

- Build around the poker hand and scaling engine the current jokers and deck actually support; spend discards on cards that serve that plan.
- Read the blind's chip target and the chips already scored from live state, never from memory.
- Check blind restrictions before selecting cards for a hand.
- Weigh the skip reward in `balatro://ante` against the cash, shop access, and scaling it costs. Boss Blinds cannot be skipped.
- In the shop, cover the next blind's cash requirement and interest before spending.
- Joker order affects scoring; when it matters, confirm the intended order and set it with `balatro_reorder_jokers`.

## Rationale

Give a short rationale only when a decision is non-obvious: the constraint or comparison that drove it. Skip it when the action speaks for itself.
