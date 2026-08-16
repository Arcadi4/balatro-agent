love = {
  data = {
    hash = function(_, value) return value end,
    encode = function(_, _, value) return value end,
  },
  timer = { getTime = function() return 1 end },
}

package.path = 'mod/src/?.lua;' .. package.path

local hidden_hand = {
  sort_id = 101,
  facing = 'back',
  label = 'Ace of Spades',
  base = { name = 'Ace of Spades', value = 'Ace', suit = 'Spades' },
  ability = { name = 'Bonus Card' },
  edition = { polychrome = true },
  seal = 'Red',
  debuff = true,
}
local visible_hand = {
  sort_id = 102,
  facing = 'front',
  label = 'King of Hearts',
  base = { name = 'King of Hearts', value = 'King', suit = 'Hearts' },
  ability = { name = 'Default Base' },
}
local hidden_joker = {
  sort_id = 201,
  facing = 'back',
  ability = { name = 'Blueprint', extra = { value = 99 } },
  config = { center = { key = 'j_blueprint', set = 'Joker', rarity = 3 } },
  sell_cost = 5,
  cost = 10,
}
local visible_joker = {
  sort_id = 202,
  facing = 'front',
  ability = { name = 'Joker' },
  config = { center = { key = 'j_joker', set = 'Joker', rarity = 1 } },
  sell_cost = 1,
  cost = 2,
}

G = {
  hand = {
    cards = { hidden_hand, visible_hand },
    highlighted = { hidden_hand },
    config = { card_limit = 8, highlighted_limit = 5 },
  },
  jokers = { cards = { hidden_joker, visible_joker }, config = { card_limit = 5 } },
}

local card_ids = require('card_ids')
local state_module = require('state')
state_module.configure(card_ids)
local state = state_module.get_state_envelope().payload
local hidden_hand_state
for _, card in ipairs(state.hand) do
  if card.faced_down then hidden_hand_state = card end
end
assert(hidden_hand_state)
assert(type(hidden_hand_state.card_id) == 'string' and hidden_hand_state.card_id:match('^hidden%-card%-'))
assert(hidden_hand_state.card_id ~= tostring(hidden_hand.sort_id))
assert(hidden_hand_state.kind == 'playing_card')
assert(hidden_hand_state.faced_down == true)
assert(hidden_hand_state.name == nil and hidden_hand_state.rank == nil and hidden_hand_state.suit == nil)
assert(hidden_hand_state.enhancement == nil and hidden_hand_state.edition == nil and hidden_hand_state.seal == nil)
assert(hidden_hand_state.debuffed == nil and hidden_hand_state.stickers == nil)
assert(state.selected_hand_card_ids[1] == hidden_hand_state.card_id)
local visible_hand_state
for _, card in ipairs(state.hand) do
  if not card.faced_down then visible_hand_state = card end
end
assert(visible_hand_state.card_id == 102 and visible_hand_state.rank == 'King' and visible_hand_state.suit == 'Hearts')

local hidden_joker_state
for _, card in ipairs(state.jokers) do
  if card.faced_down then hidden_joker_state = card end
end
assert(hidden_joker_state)
assert(type(hidden_joker_state.card_id) == 'string' and hidden_joker_state.card_id:match('^hidden%-card%-'))
assert(hidden_joker_state.card_id ~= tostring(hidden_joker.sort_id))
assert(hidden_joker_state.kind == 'joker')
assert(hidden_joker_state.faced_down == true)
assert(hidden_joker_state.name == nil and hidden_joker_state.entity_id == nil)
assert(hidden_joker_state.rarity == nil and hidden_joker_state.live_description == nil)
assert(hidden_joker_state.sell_value == nil and hidden_joker_state.cost == nil)
assert(hidden_joker_state.edition == nil and hidden_joker_state.stickers == nil)
assert(hidden_joker_state.debuffed == nil and hidden_joker_state.active == nil and hidden_joker_state.extras == nil)
local visible_joker_state
for _, card in ipairs(state.jokers) do
  if not card.faced_down then visible_joker_state = card end
end
assert(visible_joker_state.card_id == 202 and visible_joker_state.name == 'Joker')

local selected = {}
function G.hand:unhighlight_all()
  self.highlighted = {}
end
function G.hand:add_to_highlighted(card)
  self.highlighted[#self.highlighted + 1] = card
  selected[#selected + 1] = card
end
G.STATES = { SELECTING_HAND = 1, SHOP = 2 }
G.STAGES = { MAIN_MENU = 1, RUN = 2 }
G.STATE = G.STATES.SELECTING_HAND
function G.jokers:set_ranks() end
G.FUNCS = {}

local actions = require('actions')
actions.configure(card_ids)
local selection = actions.select_hand_cards({ card_ids = { hidden_hand_state.card_id } })
assert(selection.ok and selected[1] == hidden_hand)
assert(selection.data.selected_card_ids[1] == hidden_hand_state.card_id)

local hidden_sale = actions.sell_card({ card_id = hidden_joker_state.card_id })
assert(not hidden_sale.ok and hidden_sale.error_code == 'CANNOT_USE_NOW')

local reordered = actions.reorder_jokers({ card_ids = { 202, hidden_joker_state.card_id } })
assert(reordered.ok and G.jokers.cards[1] == visible_joker and G.jokers.cards[2] == hidden_joker)

local reordered_state = state_module.get_state_envelope().payload
local prior_hidden_joker_id
for _, joker in ipairs(reordered_state.jokers) do
  if joker.faced_down then prior_hidden_joker_id = joker.card_id end
end
local stable_hidden_state = state_module.get_state_envelope().payload
local stable_hidden_id
for _, joker in ipairs(stable_hidden_state.jokers) do
  if joker.faced_down then stable_hidden_id = joker.card_id end
end
assert(stable_hidden_id == prior_hidden_joker_id)
G.jokers.cards = { hidden_joker, visible_joker }
local shuffled_hidden_state = state_module.get_state_envelope().payload
local shuffled_hidden_id
for _, joker in ipairs(shuffled_hidden_state.jokers) do
  if joker.faced_down then shuffled_hidden_id = joker.card_id end
end
assert(shuffled_hidden_id ~= prior_hidden_joker_id)

local old_handle = hidden_hand_state.card_id
hidden_hand.facing = 'front'
hidden_hand.sprite_facing = 'back'
local flip_window_state = state_module.get_state_envelope().payload
local flip_window_card
for _, card in ipairs(flip_window_state.hand) do
  if card.faced_down then flip_window_card = card end
end
assert(flip_window_card and flip_window_card.card_id == old_handle)
assert(flip_window_card.rank == nil and flip_window_card.suit == nil)
hidden_hand.sprite_facing = 'front'
card_ids.update()
hidden_hand.facing = 'back'
hidden_hand.sprite_facing = 'back'
local rehidden_state = state_module.get_state_envelope().payload
for _, card in ipairs(rehidden_state.hand) do
  if card.faced_down then hidden_hand_state = card end
end
assert(hidden_hand_state.card_id ~= old_handle)

G.GAME = {
  chips = 0,
  current_round = { hands_left = 4, hands_played = 0 },
  blind = { chips = 100 },
}
G.hand.highlighted = { hidden_hand, visible_hand }
G.FUNCS.play_cards_from_highlighted = function() end
local played = actions.play_hand({})
assert(played.ok and played.deferred == 'play_hand_score')
assert(#played.data.played_cards == 2)
assert(played.data.played_cards[1].faced_down == true)
assert(played.data.played_cards[1].rank == nil and played.data.played_cards[1].suit == nil)
assert(played.data.played_cards[2].rank == 'King' and played.data.played_cards[2].suit == 'Hearts')
G.hand.highlighted = {}

local reroll_calls = 0
G.STATES.BLIND_SELECT = 3
G.STAGES = { MAIN_MENU = 1, RUN = 2 }
G.STATE = G.STATES.BLIND_SELECT
G.GAME = {
  dollars = 20,
  bankrupt_at = 0,
  blind_on_deck = 'Boss',
  round_resets = {
    ante = 2,
    blind_ante = 2,
    blind_choices = { Small = 'bl_small', Big = 'bl_big', Boss = 'bl_fish' },
    blind_states = { Small = 'Defeated', Big = 'Defeated', Boss = 'Select' },
    boss_rerolled = false,
  },
  used_vouchers = { v_directors_cut = true },
}
G.P_BLINDS = {
  bl_small = { key = 'bl_small', name = 'Small Blind', mult = 1, vars = {} },
  bl_big = { key = 'bl_big', name = 'Big Blind', mult = 1.5, vars = {} },
  bl_fish = { key = 'bl_fish', name = 'The Fish', mult = 2, vars = {} },
}
G.FUNCS.reroll_boss = function()
  reroll_calls = reroll_calls + 1
  G.GAME.dollars = G.GAME.dollars - 10
  G.GAME.round_resets.boss_rerolled = true
  G.GAME.round_resets.blind_choices.Boss = 'bl_mark'
end
G.CONTROLLER = { locks = {} }
G.blind_select_opts = nil
function get_blind_amount(ante) return ante * 100 end
function localize(args)
  if type(args) == 'table' and args.type == 'raw_descriptions' then
    return args.key == 'bl_fish' and { 'Cards drawn face down', 'after each hand played' } or {}
  end
  return tostring(args)
end

local boss_state = state_module.get_state_envelope().payload
assert(boss_state.blind_select.boss_reroll_cost == 10)
assert(boss_state.blind_select.blinds[3].description == 'Cards drawn face down after each hand played')
local has_reroll = false
for _, action in ipairs(boss_state.legal_actions) do
  if action == 'reroll_boss' then has_reroll = true end
end
assert(has_reroll)

local original_jokers = G.jokers.cards
G.jokers.cards = { hidden_joker }
hidden_joker.ability.eternal = true
local eternal_hidden_state = state_module.get_state_envelope().payload
hidden_joker.ability.eternal = nil
local sellable_hidden_state = state_module.get_state_envelope().payload
G.jokers.cards = original_jokers
local eternal_can_sell = false
for _, action in ipairs(eternal_hidden_state.legal_actions) do
  if action == 'sell_card' then eternal_can_sell = true end
end
assert(not eternal_can_sell)
local sellable_can_sell = false
for _, action in ipairs(sellable_hidden_state.legal_actions) do
  if action == 'sell_card' then sellable_can_sell = true end
end
assert(not sellable_can_sell)

local rerolled = actions.reroll_boss({})
assert(rerolled.ok and reroll_calls == 1)
assert(rerolled.data.previous_boss == 'bl_fish' and rerolled.data.cost == 10)
local rerolled_twice = actions.reroll_boss({})
assert(not rerolled_twice.ok and rerolled_twice.error_code == 'INVALID_TARGET')
local post_reroll_state = state_module.get_state_envelope().payload
local director_reroll_available = false
for _, action in ipairs(post_reroll_state.legal_actions) do
  if action == 'reroll_boss' then director_reroll_available = true end
end
assert(not director_reroll_available)

G.GAME.used_vouchers.v_retcon = true
local retcon_reroll = actions.reroll_boss({})
assert(retcon_reroll.ok and reroll_calls == 2)

G.GAME.dollars = 0
local unaffordable_reroll = actions.reroll_boss({})
assert(not unaffordable_reroll.ok and unaffordable_reroll.error_code == 'INSUFFICIENT_FUNDS')

local deck_ace = {
  sort_id = 301,
  area = {},
  base = { id = 14, value = 'Ace', suit = 'Spades' },
  ability = { name = 'Default Base' },
}
function deck_ace:is_suit(suit) return suit == 'Spades' end
function deck_ace:is_face() return false end
local wild_king = {
  sort_id = 302,
  area = deck_ace.area,
  base = { id = 13, value = 'King', suit = 'Hearts' },
  ability = { name = 'Wild Card' },
}
function wild_king:is_suit() return true end
function wild_king:is_face() return true end
local debuffed_queen = {
  sort_id = 303,
  area = deck_ace.area,
  base = { id = 12, value = 'Queen', suit = 'Diamonds' },
  ability = { name = 'Default Base' },
  debuff = true,
}
function debuffed_queen:is_suit() return false end
function debuffed_queen:is_face() return false end
hidden_hand.ability.wheel_flipped = true
hidden_hand.area = G.hand
G.deck = { cards = { deck_ace, wild_king, debuffed_queen } }
deck_ace.area = G.deck
wild_king.area = G.deck
debuffed_queen.area = G.deck
visible_hand.area = G.hand
G.playing_cards = { deck_ace, wild_king, debuffed_queen, hidden_hand, visible_hand }

local deck_summary = state_module.get_state_envelope().payload.deck_summary
assert(deck_summary.remaining.count == 4 and deck_summary.remaining.draw_pile_count == 3)
assert(deck_summary.full_deck.count == 5 and deck_summary.full_deck.unknown_count == 1)
assert(deck_summary.remaining.unknown_count == 1)
assert(deck_summary.remaining.tallies.by_suit.Spades.base == 1)
assert(deck_summary.remaining.tallies.by_suit.Spades.effective == 2)
assert(deck_summary.remaining.tallies.by_suit.Diamonds.base == 1)
assert(deck_summary.remaining.tallies.by_suit.Diamonds.effective == 1)
assert(deck_summary.remaining.tallies.categories.face_cards.base == 2)
assert(deck_summary.remaining.tallies.categories.face_cards.effective == 1)
local hidden_deck_card
local nonremaining_card
for _, card in ipairs(deck_summary.remaining.cards) do
  if card.faced_down then hidden_deck_card = card end
  if card.remaining == false then nonremaining_card = card end
end
assert(hidden_deck_card and hidden_deck_card.rank == nil and hidden_deck_card.suit == nil)
assert(nonremaining_card and nonremaining_card.remaining == false)

print('deck UI parity tests passed')

G.STATE = G.STATES.SELECTING_HAND
G.GAME.current_round = { hands_left = 4, discards_left = 3, hands_played = 0, discards_used = 0 }
G.GAME.blind = {
  name = 'The Arm',
  chips = 10000,
  config = { blind = { key = 'bl_arm', name = 'The Arm', vars = {} } },
  get_loc_debuff_text = function() return 'Decreases level of played poker hand' end,
}
local round_state = state_module.get_state_envelope().payload
assert(round_state.round.blind.description == 'Decreases level of played poker hand')

print('face-down card state tests passed')
