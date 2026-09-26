<!-- oxfmt-ignore-start -->

# Balatro Stakes Reference

Pass the integer value below as the `stake` argument to `balatro_new_game`. Modifiers are cumulative: every stake also carries the modifiers of all lower stakes. Fetch the full wiki article for a stake as `balatro://wiki/<Name>` with underscores for spaces, e.g. `balatro://wiki/White_Stake`.

| stake | Name         | Effect                                             |
| ----- | ------------ | -------------------------------------------------- |
| `1`   | White Stake  | no modifier                                        |
| `2`   | Red Stake    | Small Blind gives no reward money                  |
| `3`   | Green Stake  | required Blind score scales up for each Ante       |
| `4`   | Black Stake  | Shop Jokers can carry the Eternal sticker          |
| `5`   | Blue Stake   | -1 discard every round                             |
| `6`   | Purple Stake | required Blind score scales up faster for each Ante |
| `7`   | Orange Stake | Shop Jokers can carry the Perishable sticker       |
| `8`   | Gold Stake   | Shop Jokers can carry the Rental sticker           |

Each in-run sticker has a 30% appearance rate on Jokers found in the Shop or a Booster Pack; see `balatro://card_modifiers/stickers` for what each one does.

A stake has to be unlocked per deck by winning a run on the previous stake with that deck. Challenge runs always use White Stake, so `stake` cannot be passed together with `challenge`.

<!-- oxfmt-ignore-end -->
