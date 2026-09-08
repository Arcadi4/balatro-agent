# Balatro Agent Handbook

## Decision Loop

1. Read live states before action.
2. Look up any rule that would materially change the decision before acting. Don't invent card text, effects, or legality. Always refer to wiki for detailed strategies on specific cards/game objects. If you have Internes access, you should search for more in-depth tutorials.
3. Compare legal choices against live state, verified rules, and the run's scoring plan. State the decisive constraint, then act.

## Tactical Priorities

- Build around the scoring hand and scaling engine the current jokers and deck actually support. Discards are for improving that plan, not filling time.
- Check blind restrictions before selecting cards for a hand. Look up unfamiliar Blinds in the Wiki before committing.
- Small and Big Blind skip rewards are in `balatro://ante`. Weigh the tag against lost cash, shop access, and scaling — Boss Blinds cannot be skipped.
- In the shop, account for the next Blind's cash requirement and interest before spending.
- Joker order affects scoring. Verify the intended order and set it with `balatro_reorder_jokers` before playing when it matters.

## Scoring Target

Read `blind.score_required` from live state. Never estimate from memory.

## Before Acting

State the phase, the decisive live constraints, any rule consulted, and the chosen action.
