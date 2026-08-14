<!-- oxfmt-ignore-start -->

# Balatro Card Modifiers Reference

Modifiers are upgrades applied to cards that improve scoring, generate consumables/money, or manipulate cards. There are **4 modifier types**:

| Type | Applies to | Sub-page |
|------|-----------|----------|
| Enhancements | Playing cards (one each) | `balatro://card_modifiers/enhancements` |
| Seals | Playing cards (one each) | `balatro://card_modifiers/seals` |
| Editions | Playing cards, Jokers, Consumables (one each) | `balatro://card_modifiers/editions` |
| Stickers | Jokers (multiple), Decks | `balatro://card_modifiers/stickers` |

## General rules

- **Playing cards** may each have one Enhancement, one Edition, and one Seal.
- **Jokers** may have one Edition and multiple Stickers.
- **Consumables** (Tarot, Planet, Spectral) normally have no modifiers, except a Negative edition via Perkeo.
- **Vouchers** and **Booster Packs** can never have modifiers.
- Modifiers persist for the rest of the run. Applying an enhancement or seal to a card that already has one **replaces** it. Editions and Stickers are permanent and cannot be changed or overwritten.
- Modifiers are applied via Tarot or Spectral cards, or found in Booster Packs / the Shop (Illusion voucher).
- **Debuffed** cards and Jokers have all modifier effects disabled except Negative (+1 slot) and Stone cards (no rank/suit). Debuffed Wild cards revert to their original suit.

## Sub-pages

- `balatro://card_modifiers/enhancements` — 8 card enhancements (Bonus, Mult, Wild, Glass, Steel, Stone, Gold, Lucky)
- `balatro://card_modifiers/seals` — 4 seals (Gold, Red, Blue, Purple)
- `balatro://card_modifiers/editions` — 5 editions (Base, Foil, Holographic, Polychrome, Negative) and their scoring timing
- `balatro://card_modifiers/stickers` — in-run stickers (Eternal, Perishable, Rental)

Wiki source: https://balatrowiki.org/w/Card_modifiers

<!-- oxfmt-ignore-end -->
