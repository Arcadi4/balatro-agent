# Balatro Game Rules Reference

Version: 1.1  
Last Updated: 2026-06-03

## Run Loop

- **Ante Structure**: Each run has 8 Antes (rounds), each with 3 Blinds: Small Blind, Big Blind, Boss Blind
- **Small/Big Blinds**: Can be skipped for Tags (bonuses); Boss Blinds must be played
- **Win Condition**: Defeat the Boss Blind at Ante 8; optionally continue in Endless Mode (Ante 9+)
- **Defeat Condition**: Play a hand and score chips to meet the Blind's requirement; limited hands and discards per Blind

Source: https://balatrowiki.org/w/Gameplay_loop

## Game Phases

- **BLIND_SELECT**: Choose to play or skip Small/Big Blind, or face Boss Blind
- **SELECTING_HAND**: Play poker hands (up to 5 cards) to score chips; use discards to improve hand
- **SHOP**: Purchase Jokers, Consumables, Vouchers, Booster Packs; reroll shop inventory
- **Booster Pack States**: Open packs (Arcana/Celestial/Standard/Buffoon/Spectral) and select cards
- **ROUND_EVAL**: Cash out after defeating Blind; earn money based on remaining hands + interest

Source: https://balatrowiki.org/w/Gameplay_loop

## High-Risk Rules Agents Often Hallucinate

- **Debuffed/disabled cards can still be selected and played**. They can still form the named poker hand, but debuffed cards do not score, do not contribute chips/mult, and do not trigger card or Joker effects. Do not treat a debuffed card as illegal unless the live state says the action is blocked.
- **Boss Blind hand restrictions can allow a play while nullifying it**. A hand that violates a Boss Blind restriction may be playable but may not score or trigger effects.
- **Only scoring cards count by default**. Extra played cards can be used like an extra discard, but they do not score or trigger scored-card effects unless a rule/Joker such as Splash changes that.
- **Runtime state beats memory and wiki summaries**. Always inspect live debuffs, selected cards, legal actions, hand/discard counts, money, blind effect, and available card IDs before acting.

Sources: https://balatrowiki.org/w/Poker_hands, https://balatrowiki.org/w/Card_modifiers, https://balatrowiki.org/w/Blinds_and_Antes

## Poker Hand Evaluation (Highest to Lowest)

1. **Flush Five**: 160 chips x 16 mult (secret; five cards of same rank and same suit)
2. **Flush House**: 140 chips x 14 mult (secret; Full House that is also a Flush)
3. **Five of a Kind**: 120 chips x 12 mult (secret; five cards of same rank, not all same suit)
4. **Royal Flush**: 100 chips x 8 mult (Straight Flush with 10-A; generally treated as Straight Flush for hand-level tracking)
5. **Straight Flush**: 100 chips x 8 mult (5 consecutive cards, same suit)
6. **Four of a Kind**: 60 chips x 7 mult
7. **Full House**: 40 chips x 4 mult (3 of a kind + pair)
8. **Flush**: 35 chips x 4 mult (5 cards, same suit)
9. **Straight**: 30 chips x 4 mult (5 consecutive ranks; A can be high or low, not both)
10. **Three of a Kind**: 30 chips x 3 mult
11. **Two Pair**: 20 chips x 2 mult
12. **Pair**: 10 chips x 2 mult
13. **High Card**: 5 chips x 1 mult

Secret hands appear in Run Info only after being played in the current run; their Planet cards then become obtainable during that run.

Source: https://balatrowiki.org/w/Poker_Hands

## Money Rules

- **Earning**: Defeat Blinds for base reward + $1/remaining hand + interest ($1 per $5 held, base max $5 at $25; Seed Money/Money Tree raise this cap)
- **Shop Reroll**: Starts at $5, increases $1 per reroll, resets when entering new shop
- **Buy Cost**: (base_cost + edition_cost) x discount_percent (min $1)
- **Sell Value**: floor(buy_cost / 2) (min $1)
- **Voucher Discounts**: Clearance Sale (25% off), Liquidation (50% off)
- **Debt**: Credit Card allows up to -$20 debt; The Tooth and Rental sticker charges can also reduce money below $0

Source: https://balatrowiki.org/w/The_Shop, https://balatrowiki.org/w/Money

## Card Modifier Interactions

- **Eternal Sticker**: Joker cannot be sold or destroyed (Black Stake+, 30% chance in shops/packs)
- **Perishable Sticker**: Joker is debuffed after 5 rounds (Orange Stake+, 30% chance in shops/packs); cannot coexist with Eternal
- **Rental Sticker**: Joker costs $1 to buy and charges $3/round (Gold Stake, 30% chance in shops/packs); can stack with Eternal/Perishable
- **Editions**: Foil (+50 chips), Holographic (+10 mult), Polychrome (x1.5 mult), Negative (+1 Joker slot)
- **Enhancements/Seals**: One per playing card; replaced if new one applied; Editions are permanent
- **Debuffed Cards/Jokers**: Modifier effects are disabled except Negative slot effects and Stone cards' no-rank/no-suit identity; debuffed Wild cards revert to their original suit

Source: https://balatrowiki.org/w/Card_Modifiers, https://balatrowiki.org/w/Stickers

## Booster Pack Pick Counts

| Pack Type | Normal ($4) | Jumbo ($6) | Mega ($8) |
|-----------|-------------|------------|-----------|
| Arcana (Tarot, immediate use) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Celestial (Planet, immediate use) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Standard (Playing Cards added to deck) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Buffoon (Jokers) | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |
| Spectral (Spectral, immediate use) | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |

- **Shop Inventory**: 2 random cards + 2 Booster Packs + 1 Voucher (default)
- **Reroll Behavior**: Packs and Vouchers do NOT restock on reroll; only on new shop entry

Source: https://balatrowiki.org/w/Booster_Packs

## Stakes Summary

Stakes are cumulative difficulty modifiers (each adds to previous):

1. **White**: Base difficulty
2. **Red**: Small Blind gives no money
3. **Green**: Score requirement scales faster
4. **Black**: 30% Eternal Jokers (cannot sell/destroy)
5. **Blue**: -1 Discard
6. **Purple**: Score scales even faster
7. **Orange**: 30% Perishable Jokers (debuff after 5 rounds)
8. **Gold**: 30% Rental Jokers ($1 buy, $3/round cost)

Green/Purple stakes change the Ante chip table, not the poker-hand scoring formula. Use live `blind.score_required` as the source of truth.

Source: https://balatrowiki.org/w/Stakes

## Endless Mode

- **Activation**: After defeating Ante 8 Boss Blind, choose to continue
- **Scaling**: Score requirements increase exponentially (Ante 9: 110k base, Ante 10: 560k base, etc.)
- **Showdown Blinds**: Appear every 8 Antes (Ante 8, 16, 24, 32...)

Source: https://balatrowiki.org/w/Blinds_and_Antes

## Challenge Mode

- **Challenge Decks**: Pre-configured runs with special rules and restrictions
- **Examples**: Inflation (prices increase $1 per purchase), specific Joker/Voucher restrictions
- **Unlocks**: Completing challenges unlocks new Jokers, Decks, or other content

Source: https://balatrowiki.org/w/Balatro

---

## Attribution

Content summarized from Balatro Wiki (https://balatrowiki.org), licensed under CC BY-NC-SA 3.0.  
This reference is for AI agent use in the Balatro MCP Bridge project.

Original wiki pages:
- Gameplay Loop: https://balatrowiki.org/w/Gameplay_loop
- Poker Hands: https://balatrowiki.org/w/Poker_Hands
- The Shop: https://balatrowiki.org/w/The_Shop
- Money: https://balatrowiki.org/w/Money
- Booster Packs: https://balatrowiki.org/w/Booster_Packs
- Card Modifiers: https://balatrowiki.org/w/Card_Modifiers
- Stickers: https://balatrowiki.org/w/Stickers
- Stakes: https://balatrowiki.org/w/Stakes
- Blinds and Antes: https://balatrowiki.org/w/Blinds_and_Antes
