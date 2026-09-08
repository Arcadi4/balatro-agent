<!-- oxfmt-ignore-start -->

# Balatro Stakes Reference

Each stake's `stake` is the integer value (1-8) to pass as the `stake` argument to `balatro_new_game`. Stake modifiers are cumulative: each stake includes the modifiers of all previous stakes. Wiki links point to the full article for each stake.

| stake | Name | Effect | Wiki |
|-------|------|--------|------|
| `1` | White Stake | Base difficulty | https://balatrowiki.org/w/White_Stake |
| `2` | Red Stake | Small Blind gives no reward money | https://balatrowiki.org/w/Red_Stake |
| `3` | Green Stake | Required score scales faster for each Ante | https://balatrowiki.org/w/Green_Stake |
| `4` | Black Stake | Shop can have Eternal Jokers (30% chance; cannot be sold or destroyed) | https://balatrowiki.org/w/Black_Stake |
| `5` | Blue Stake | -1 discard every round | https://balatrowiki.org/w/Blue_Stake |
| `6` | Purple Stake | Required score scales even faster for each Ante | https://balatrowiki.org/w/Purple_Stake |
| `7` | Orange Stake | Shop can have Perishable Jokers (30% chance; debuffed after 5 rounds) | https://balatrowiki.org/w/Orange_Stake |
| `8` | Gold Stake | Shop can have Rental Jokers (30% chance; costs $1 to buy, charges $3 at end of round) | https://balatrowiki.org/w/Gold_Stake |

Higher stakes must be unlocked for each deck individually by winning a run on the previous stake with that deck. Challenge runs always use White Stake and cannot specify a `stake`.

<!-- oxfmt-ignore-end -->
