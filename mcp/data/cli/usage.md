<!-- oxfmt-ignore-start -->

# Balatro CLI

`balatro` is the standalone command-line client for the Balatro MCP server. It reads the same resources and runs the same validated game commands, wiki search, and post-game writes as the MCP tools, without an MCP client. The game remains the state authority: commands are validated against the live game and rejected when the current phase does not allow them.

A one-shot invocation runs one command and exits. `balatro repl` keeps a single process, and its connections, alive for a sequence of commands.

## Install

```sh
npm install -g balatro-mcp
balatro --help
```

Without a global install:

```sh
npm exec --package=balatro-mcp -- balatro read balatro://instances
```

The CLI ships in the `balatro-mcp` package and installs the `balatro` executable. The npm name `balatro` belongs to an unrelated package, so `npx balatro` does not run this CLI. Native archives on GitHub Releases contain both `balatro-mcp` and `balatro` and need no Node or Bun.

## Entry points

```sh
balatro
balatro --help
balatro --version
```

A bare `balatro` invocation prints short usage. `--help` prints the generated command usage for the CLI or for one command, with a pointer to `balatro://cli`; the command list is not duplicated there. `--version` prints the installed package version.

## Sessions and instance targeting

Every Balatro launch is a separate live instance. `read balatro://instances` lists them with 0-based indices ordered oldest-first by launch time. Discovery renumbers the list, so an index can point at a different game after another instance starts or exits; re-read the list before acting on an index you obtained earlier.

- With exactly one live instance, game commands accept an omitted instance and unscoped live resource URIs resolve to it.
- With several live instances, pass `-i, --instance <index>` to a game command, or read a scoped resource such as `balatro://instances/1/turn`. An omitted index fails before acting with `INSTANCE_SELECTION_REQUIRED` and the current numbered list.
- With no live instance, live requests fail with `GAME_NOT_RUNNING`.
- `-i, --instance` is accepted only by game commands and by `connect` / `disconnect`. Reads never take it: `read` resolves exactly the URI it is given, so the scoped form is how a read chooses a game.

One-shot commands have no persistent session. Actions and live reads open IPC connections on demand, and `connect` is optional. `connect` in a one-shot invocation resolves the target, opens a session, and reports its phase before the process exits; `disconnect` in a one-shot invocation has no earlier session to preserve and can report that no session was open. Inside `repl`, both commands carry real state until the process ends.

## Resource reads

```sh
balatro read <uri>
balatro read <uri> --json
```

`read` prints the resource's Markdown text exactly as the MCP server serves it. Human mode writes that text to stdout; `--json` writes `{ "uri": "...", "mimeType": "text/markdown", "text": "..." }`.

### Live state

```text
balatro://instances
balatro://turn            balatro://hand          balatro://jokers
balatro://consumables     balatro://deck          balatro://shop
balatro://booster         balatro://run           balatro://ante
balatro://instances/<index>/<section>
```

The sections are `turn`, `hand`, `jokers`, `consumables`, `deck`, `shop`, `booster`, `run`, and `ante`. A scoped URI reads that game regardless of how many instances are live. An unscoped section alias follows the exactly-one-instance rule. A section read outside its legal phase fails with `UNAVAILABLE` instead of returning a snapshot.

Read `balatro://turn` (or `balatro://instances/<index>/turn`) before acting: it carries the phase, round, legal actions, hand, jokers, and consumables for the next decision.

### Reference

```text
balatro://wiki/index        balatro://wiki/<Title>
balatro://decks             balatro://stakes          balatro://challenges
balatro://card_modifiers
balatro://card_modifiers/enhancements
balatro://card_modifiers/seals
balatro://card_modifiers/editions
balatro://card_modifiers/stickers
```

Wiki titles use underscores for spaces, for example `balatro://wiki/Red_Deck`; percent-encoded titles are also accepted. `balatro://wiki/index` lists useful pages, and `balatro wiki search` finds a title when it is unknown. A wiki article the wiki itself does not have is reported as a missing resource, while network and HTTP failures remain internal errors.

Deck keys and stake numbers feed `new-game`, and challenge ids feed `new-game --challenge`. `balatro://card_modifiers` is the index for its four rule subpages.

### Post-game analyses

```text
postgame://
postgame://<index>
```

`postgame://` lists stored analyses with their indices and summaries. An index is a positive integer assigned when the analysis is created; `postgame://<index>` reads that analysis. A missing or malformed index fails instead of returning empty text.

### CLI reference

```sh
balatro read balatro://cli
```

This document is served as `balatro://cli` and is the single full CLI reference.

## Game commands

Game commands map one-to-one onto the MCP action tools. Each accepts `-i, --instance <index>` and validates its arguments before sending anything; an illegal game phase or rejected action is reported by the game.

| Command                                       | Arguments                              |
| --------------------------------------------- | -------------------------------------- |
| `select-blind`                                | none                                   |
| `skip-blind`                                  | none                                   |
| `play-hand`                                   | none; plays the current hand selection |
| `discard-hand`                                | none                                   |
| `reroll-shop`                                 | none                                   |
| `reroll-boss`                                 | none                                   |
| `leave-shop`                                  | none                                   |
| `cash-out`                                    | none                                   |
| `skip-booster`                                | none                                   |
| `restart`                                     | none                                   |
| `continue-game`                               | none                                   |
| `sell-card <card-id>`                         | one card id                            |
| `buy-card <card-id>`                          | one card id                            |
| `buy-voucher <card-id>`                       | one card id                            |
| `buy-booster <card-id>`                       | one card id                            |
| `select-hand-cards [<card-id>...]`            | zero or more card ids                  |
| `sort-hand --order rank\|suit`                | required `--order`                     |
| `reorder-hand <card-id>...`                   | every current hand card id             |
| `reorder-jokers <card-id>...`                 | every current joker card id            |
| `use-consumable <card-id> [--target <card-id>]...`      | one card id, repeatable targets |
| `select-booster-card <card-id> [--target <card-id>]...` | one card id, repeatable targets |
| `buy-consumable <card-id> [--use] [--target <card-id>]...` | one card id              |
| `new-game --deck <key> --stake <1-8> [--seed <seed>]` | normal run                |
| `new-game --challenge <id>`                   | challenge run                          |

Card ids are the ids shown by live resources. Pass them as separate positional arguments.

- `select-hand-cards` highlights the listed hand cards. With no ids it clears the selection. Duplicates are rejected, and at most 50 cards can be selected.
- `reorder-hand` and `reorder-jokers` take every current card id exactly once, left to right. They reject a partial list, a duplicate, or an unknown id.
- `--target` names a hand card the consumable or booster pick affects. It is repeatable, accepts at most 50 distinct ids, and is required for hand-targeting consumables.
- `buy-consumable --use` applies the consumable immediately instead of storing it. `--target` is valid only together with `--use`.
- `new-game` is either a normal run with both `--deck` and `--stake` and an optional `--seed`, or a challenge run with `--challenge` alone. Deck, stake, or seed combined with `--challenge` is rejected. Deck keys, stakes, and challenges are documented at `balatro://decks`, `balatro://stakes`, and `balatro://challenges`.

## Connect and disconnect

```sh
balatro connect [--instance <index>]
balatro disconnect [--instance <index>]
```

`connect` resolves the target, opens an IPC session, and prints the instance index and game phase. It does not select a default instance and is never required before another command. `disconnect` closes the session for that instance; in a one-shot invocation it can report that no session was open. Use `repl` when a connection must persist across commands.

## Tool-backed commands

These two capabilities have no resource URI and are exposed only as MCP tools, so the CLI provides standalone commands for them.

### Wiki search

```sh
balatro wiki search <query> [--limit <1-20>]
```

Searches the Balatro Wiki and prints matching page titles with links and snippets, or a no-results message. `--limit` defaults to 10 and accepts 1 through 20. Quote a multi-word query, as in `balatro wiki search "Blue Deck" --limit 5`. JSON output is `{ "ok": true, "data": { "results": [{ "title", "snippet", "url" }] } }`.

### New post-game analysis

```sh
balatro postgame new --title <text> --summary <text> --content <text>
```

Stores a Markdown analysis of a finished run. All three values are required and non-empty; quote values that contain spaces. The command prints the assigned index and its `postgame://<index>` URI; JSON output is `{ "ok": true, "data": { "index", "uri", "filepath" } }`. List stored analyses at `postgame://`.

## Interactive shell

```sh
balatro repl [--instance <index>]
```

`repl` accepts the same command words without the leading `balatro`: `read balatro://turn`, `play-hand`, `wiki search "Blue Deck"`, and so on. Arguments are split with shell-style quoting, so single quotes, double quotes, and backslash escapes work; quote any value containing spaces. Leave with `exit` or EOF (`Ctrl-D`).

`--instance <index>` on `repl` sets the default instance for game commands and `connect` / `disconnect` in that process. A game command can pass its own `-i, --instance <index>` to override the default for that invocation. Reads never consult the default: a read resolves exactly its URI, so `read balatro://instances/1/turn` selects a game independently of the REPL default.

The shell keeps one connection per instance and reuses it across commands, including commands that resolve to the same game through different indices. `connect` and `disconnect` therefore have lasting effect inside the shell.

## Output

Human mode writes the command's Markdown rendering, or the resource text for `read`, to stdout. Errors are written to stderr as `Error [<code>]: <message>`, followed by `details` as JSON when present.

`--json` writes exactly one JSON value to stdout for both success and failure, leaving stderr for unexpected diagnostics:

- Game actions print the MCP envelope `{ "ok": true, "data": {...} }`. The CLI performs no successor read, so no `next` object follows an action.
- `connect` prints `{ "ok": true, "instance_index": N, "phase": "..." }`; `disconnect` prints `{ "ok": true, "instance_index": N }`.
- `read` prints the raw resource payload `{ "uri": "...", "mimeType": "...", "text": "..." }`.
- `wiki search` and `postgame new` print their tool result wrapped in the same envelope: `{ "ok": true, "data": { "results": [...] } }` and `{ "ok": true, "data": { "index": N, "uri": "...", "filepath": "..." } }`.
- Failures print `{ "error_code": "...", "message": "...", "details": {...} }`; `details` is optional.

Structured errors use the same codes as the MCP tools, such as `GAME_NOT_RUNNING`, `INSTANCE_SELECTION_REQUIRED`, `UNAVAILABLE`, and `BRIDGE_TIMEOUT`.

## Exit codes

| Code | Meaning                                                                 |
| ---- | ----------------------------------------------------------------------- |
| 0    | Success                                                                 |
| 1    | Unexpected or internal error                                            |
| 2    | Usage error: unknown command or flag, missing, conflicting, or invalid arguments, or an invalid resource URI |
| 3    | `GAME_NOT_RUNNING`: no live instance                                    |
| 4    | `INSTANCE_SELECTION_REQUIRED`: several live instances and no index      |
| 5    | Other bridge or game error, including a rejected action, a missing resource, or a failed read |

JSON mode does not change exit codes: the process still exits with the code above while printing the structured error to stdout.

## Examples

```sh
balatro read balatro://instances
balatro read balatro://instances/0/turn
balatro -i 0 play-hand
balatro select-hand-cards 42 43 44
balatro sort-hand --order suit
balatro buy-consumable 7 --use --target 12
balatro reorder-jokers 31 18 44
balatro new-game --deck b_blue --stake 2 --seed 0ABC
balatro new-game --challenge c_omelette_1
balatro wiki search "Blue Deck" --limit 5
balatro read postgame://
balatro postgame new --title "Blue Deck flush run" --summary "Flush scaling on Blue Deck" --content "## What worked..."
balatro read balatro://cli --json
```

<!-- oxfmt-ignore-end -->
