<!-- oxfmt-ignore-start -->

# Balatro Game Rules Reference

## Run Loop

- **Ante Structure**: Each run has 8 Antes (rounds), each with 3 Blinds: Small Blind, Big Blind, Boss Blind
- **Small/Big Blinds**: Can be skipped for Tags (bonuses); Boss Blinds must be played
- **Win Condition**: Defeat the Boss Blind at Ante 8; optionally continue in Endless Mode (Ante 9+)
- **Defeat Condition**: Play a hand and score chips to meet the Blind's requirement; limited hands and discards per Blind

Wiki lookup guide: This is summarized from the Balatro Wiki page "Gameplay loop". To read the article through MCP, call `balatro_read_wiki` with `title: "Gameplay loop"`.

## Game Phases

- **BLIND_SELECT**: Choose to play or skip Small/Big Blind, or face Boss Blind
- **SELECTING_HAND**: Play poker hands (up to 5 cards) to score chips; use discards to improve hand
- **SHOP**: Purchase Jokers, Consumables, Vouchers, Booster Packs; reroll shop inventory
- **Booster Pack States**: Open packs (Arcana/Celestial/Standard/Buffoon/Spectral) and select cards
- **ROUND_EVAL**: Cash out after defeating Blind; earn money based on remaining hands + interest

Wiki lookup guide: This is summarized from the Balatro Wiki page "Gameplay loop". To read the article through MCP, call `balatro_read_wiki` with `title: "Gameplay loop"`.

## Point Calculation

The final score of a played hand is always **Score = Chips × Mult**.

### Played vs. Scored Cards (Critical Distinction)

"Played" cards are all cards you select before clicking "Play Hand". **Only the subset that actually form the poker hand are "scored"** — all others are simply discarded with no effect.

**Example**: Playing `7♥ 7♦ 3♠ 2♥` produces a Pair. Only the two 7s are **scored**; the 3♠ and 2♥ are merely **played**. They contribute **no chips, no Mult, and trigger no effects of any kind** (card enhancements, seals, editions, or "on scored" Jokers).

The only exceptions that let non-scoring cards count:

- **Splash** Joker: all played cards become scored
- **Stone cards**: always score regardless of hand type
- **Four Fingers**: can admit extra cards into Straights and Flushes

### Scoring Order

When a hand is played, effects activate in this sequence:

1. **Boss Blind effects** (e.g., The Flint halves base chips/mult, The Arm reduces hand level)
2. **"On played" Jokers** — trigger before any card scoring (e.g., Green Joker scaling, DNA)
3. **Scored cards** (left to right), each card in order:
   - Base chips (rank value) → enhancement → seal → edition → "on scored" Jokers → retriggers
4. **Held-in-hand cards** (left to right) — Steel cards, Baron, Shoot the Moon, Mime retriggers
5. **Joker editions + "Independent" Jokers** (left to right) — Foil, Holographic, Polychrome, and independent effects (e.g., Spare Trousers, The Duo, Blackboard)
6. **Score = Chips × Mult** — the final multiplication

### ×Mult Multiplies Only Prior Mult

A multiplicative bonus (×Mult) multiplies the Mult accumulated **before** it triggers, never later additions:

- **Steel ×1.5** triggers in the held-in-hand phase (step 4), **before** independent Jokers (step 5). It multiplies base Mult plus played-card/on-scored effects, but **not** independent-Joker +Mult such as Spare Trousers.
- **Joker Polychrome ×1.5** triggers right after its own Joker (step 5), multiplying that Joker's Mult but not later Jokers.
- **Glass ×2** triggers when the card is scored (step 3), multiplying Mult accumulated up to that card.

### Key Rules

- **Non-scored played cards have zero impact on the score**. Period. They don't add chips, don't trigger "on scored" Jokers, don't activate enhancements/seals/editions.
- **Debuffed cards can be played and can form hands**, but are treated as blank — they contribute no chips, no effects, and don't trigger card or Joker effects.
- **Joker order matters**: +Mult before ×Mult yields a higher score. +Chips Jokers should go leftmost.

Wiki lookup guide: This is summarized from the Balatro Wiki page "Poker hands" plus an external activation-sequence guide. To read the wiki article through MCP, call `balatro_read_wiki` with `title: "Poker hands"`; the external activation-sequence guide is not addressable by Balatro MCP tools, so use this bundled scoring-order summary instead of browsing the web.

## High-Risk Rules Agents Often Hallucinate

- **Debuffed/disabled cards can still be selected and played**. They can still form the named poker hand, but debuffed cards do not score, do not contribute chips/mult, and do not trigger card or Joker effects. Do not treat a debuffed card as illegal unless the live state says the action is blocked.
- **Boss Blind hand restrictions can allow a play while nullifying it**. A hand that violates a Boss Blind restriction may be playable but may not score or trigger effects.
- **Non-scored played cards trigger nothing**. When you play 5 cards for a Pair, only the 2 pairing cards score — the other 3 are functionally discards. See Point Calculation section for the full scoring sequence.
- **Runtime state beats memory and wiki summaries**. Always inspect live debuffs, selected cards, legal actions, hand/discard counts, money, blind effect, and available card IDs before acting.

Wiki lookup guide: This is summarized from the Balatro Wiki pages "Poker hands", "Card modifiers", and "Blinds and Antes". To read them through MCP, call `balatro_read_wiki` with article titles such as `"Poker hands"`, `"Card modifiers"`, `"Blinds and Antes"`, `"Bonus cards"`, `"Foil"`, `"Gold Seal"`, `"Stakes"`, `"Small Blind"`, or `"Big Blind"`.

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

Wiki lookup guide: This is summarized from the Balatro Wiki page "Poker hands". To read the article through MCP, call `balatro_read_wiki` with `title: "Poker hands"`.

## Money Rules

- **Earning**: Defeat Blinds for base reward + $1/remaining hand + interest ($1 per $5 held, base max $5 at $25; Seed Money/Money Tree raise this cap)
- **Shop Reroll**: Starts at $5, increases $1 per reroll, resets when entering new shop
- **Buy Cost**: (base_cost + edition_cost) x discount_percent (min $1)
- **Sell Value**: floor(buy_cost / 2) (min $1)
- **Voucher Discounts**: Clearance Sale (25% off), Liquidation (50% off)
- **Debt**: Credit Card allows up to -$20 debt; The Tooth and Rental sticker charges can also reduce money below $0

Wiki lookup guide: This is summarized from the Balatro Wiki pages "The Shop" and "Money". To read them through MCP, call `balatro_read_wiki` with `title: "The Shop"`, `"Money"`, `"Overstock"`, `"Clearance Sale"`, `"Liquidation"`, or `"Coupon Tag"`.

## Card Modifier Interactions

- **Eternal Sticker**: Joker cannot be sold or destroyed (Black Stake+, 30% chance in shops/packs)
- **Perishable Sticker**: Joker is debuffed after 5 rounds (Orange Stake+, 30% chance in shops/packs); cannot coexist with Eternal
- **Rental Sticker**: Joker costs $1 to buy and charges $3/round (Gold Stake, 30% chance in shops/packs); can stack with Eternal/Perishable
- **Editions**: Foil (+50 chips), Holographic (+10 mult), Polychrome (x1.5 mult), Negative (+1 Joker slot, only applies to Jokers)
- **Enhancements/Seals**: One per playing card; replaced if new one applied; Editions are permanent
- **Debuffed Cards/Jokers**: Modifier effects are disabled except Negative slot effects and Stone cards' no-rank/no-suit identity; debuffed Wild cards revert to their original suit

Wiki lookup guide: This is summarized from the Balatro Wiki pages "Card modifiers" and "Stickers". To read related articles through MCP, call `balatro_read_wiki` with titles such as `"Card modifiers"`, `"Stickers"`, `"Bonus cards"`, `"Mult cards"`, `"Wild cards"`, `"Glass cards"`, `"Steel cards"`, `"Stone cards"`, `"Gold cards"`, `"Lucky cards"`, `"Foil"`, `"Holographic"`, `"Polychrome"`, `"Negative"`, `"Red Seal"`, `"Blue Seal"`, `"Gold Seal"`, or `"Purple Seal"`.

## Booster Pack Pick Counts

| Pack Type                              | Normal ($4) | Jumbo ($6)  | Mega ($8)   |
| -------------------------------------- | ----------- | ----------- | ----------- |
| Arcana (Tarot, immediate use)          | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Celestial (Planet, immediate use)      | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Standard (Playing Cards added to deck) | Pick 1 of 3 | Pick 1 of 5 | Pick 2 of 5 |
| Buffoon (Jokers)                       | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |
| Spectral (Spectral, immediate use)     | Pick 1 of 2 | Pick 1 of 4 | Pick 2 of 4 |

- **Shop Inventory**: 2 random cards + 2 Booster Packs + 1 Voucher (default)
- **Reroll Behavior**: Packs and Vouchers do NOT restock on reroll; only on new shop entry

Wiki lookup guide: This is summarized from the Balatro Wiki page "Booster Packs". To read the article through MCP, call `balatro_read_wiki` with `title: "Booster Packs"`; for pack contents, pass article titles such as `"The Fool"`, `"Mercury"`, `"Familiar"`, or `"Joker"`.

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

Wiki lookup guide: This is summarized from the Balatro Wiki page "Stakes". To read the article through MCP, call `balatro_read_wiki` with `title: "Stakes"` or a redirected title such as `"White Stake"`, `"Red Stake"`, `"Green Stake"`, `"Black Stake"`, `"Blue Stake"`, `"Purple Stake"`, `"Orange Stake"`, or `"Gold Stake"`.

## Endless Mode

- **Activation**: After defeating Ante 8 Boss Blind, choose to continue
- **Scaling**: Score requirements increase exponentially (Ante 9: 110k base, Ante 10: 560k base, etc.)
- **Showdown Blinds**: Appear every 8 Antes (Ante 8, 16, 24, 32...)

Wiki lookup guide: This is summarized from the Balatro Wiki page "Blinds and Antes". To read it through MCP, call `balatro_read_wiki` with `title: "Blinds and Antes"`; for individual blind pages, pass natural article titles such as `"Small Blind"`, `"Big Blind"`, `"The Hook"`, `"The Wall"`, `"The Psychic"`, `"Amber Acorn"`, `"Verdant Leaf"`, `"Violet Vessel"`, `"Crimson Heart"`, or `"Cerulean Bell"`.

## Challenge Mode

- **Challenge Decks**: Pre-configured runs with special rules and restrictions
- **Examples**: Inflation (prices increase $1 per purchase), specific Joker/Voucher restrictions
- **Unlocks**: Completing challenges unlocks new Jokers, Decks, or other content

Wiki lookup guide: This is summarized from the Balatro Wiki's general Balatro/challenge coverage. To read challenge articles through MCP, call `balatro_read_wiki` with titles such as `"Challenge Decks"`, `"Fragile"`, `"Bram Poker"`, `"Mad World"`, or `"Jokerless"`; always combine that with live `active_challenge` state.

---

## Attribution

Content summarized from Balatro Wiki, licensed under CC BY-NC-SA 3.0.  
This reference is for AI agent use in the Balatro MCP Bridge project.

Wiki lookup guide:

- Wiki article lookup: call `balatro_read_wiki` with exact article titles.
- Special high-value article titles summarized here: "Gameplay loop", "Poker hands", "The Shop", "Money", "Booster Packs", "Card modifiers", "Stickers", "Blinds and Antes", "Score", "Chips", "Stakes", "Jokers", "Tags", "Vouchers", "Decks", "Editions", "Enhancements", and "Challenge Decks".
- Boss Blind article titles are natural names, not entity IDs: "The Hook", "The Wall", "The Psychic", "Amber Acorn", "Verdant Leaf", "Violet Vessel", "Crimson Heart", and "Cerulean Bell".
- External non-Balatro-Wiki references summarized here but not addressable by MCP tools: the activation-sequence guide and the score-calculation guide. Use the summaries in this bundled resource; do not browse the web from a game-playing agent.

<!-- oxfmt-ignore-end -->
