import type { CallToolResult } from "@modelcontextprotocol/server"
import { Command, CommanderError, InvalidArgumentError, Option } from "commander"

import packageJson from "../../package.json"
import type { BridgeClient } from "../bridge/socket-client.js"
import type { ResourceDefinition } from "../resources/catalog.js"
import { createResources, readResource } from "../resources/index.js"
import { gameActions, instanceIndexInputSchema, type GameAction } from "../tools/actions.js"
import { connectGame, disconnectGame } from "../tools/connect.js"
import { runWikiSearch, wikiSearchInputSchema } from "../tools/entities.js"
import { newPostgameInputSchema, writePostgame } from "../tools/postgame.js"
import { printCliError, printResourceResult, printToolResult } from "./output.js"
import { runRepl } from "./repl.js"

const CLI_NAME = "balatro"
const INSTANCE_DESCRIPTION =
  "Index of the live Balatro instance to act on; omit when exactly one is running."
const JSON_DESCRIPTION = "Print one machine-readable JSON value instead of Markdown."
const CARD_ID_DESCRIPTION = "Card ID from the game's live state."
const TARGET_DESCRIPTION = "Target hand card ID. Repeat for multiple targets."
const DOCUMENTATION = "Read balatro://cli for the full CLI reference."

const DECIMAL_INTEGER = /^[+-]?\d+$/

// Commander parses option values as strings; the shared Zod schemas own every
// range and shape check, so this boundary only rejects non-decimal spellings.
function parseDecimal(value: string): number {
  if (!DECIMAL_INTEGER.test(value)) {
    throw new InvalidArgumentError("Expected a decimal integer.")
  }
  return Number(value)
}

/** Detects --json when parsing failed before Commander recorded the option. */
export function jsonRequested(args: readonly string[]): boolean {
  const delimiter = args.indexOf("--")
  const tokens = delimiter === -1 ? args : args.slice(0, delimiter)
  return tokens.some((token) => token === "--json" || token.startsWith("--json="))
}

export interface CliOptions {
  /** Keep JSON output on even when a command does not pass --json. */
  readonly json?: boolean
  /** Instance used when a command omits --instance. */
  readonly defaultInstance?: number
  /** Set false for commands parsed inside the REPL. */
  readonly repl?: boolean
}

export interface CliProgram {
  readonly command: Command
  /** Exit status produced by the command that ran, defaulting to 0. */
  status(): number
}

interface ProgramContext {
  readonly bridge: BridgeClient
  setStatus(status: number): void
  json(command: Command): boolean
  instance(command: Command): number | undefined
}

interface ActionSpec {
  readonly argument?: { readonly syntax: string; readonly description: string }
  readonly configure?: (command: Command) => void
  readonly input: (command: Command) => Record<string, unknown>
}

type GameCommand = (typeof gameActions)[number]["command"]

function targetsOf(command: Command): string[] | undefined {
  const targets = command.opts<{ target?: string[] }>().target
  return targets === undefined || targets.length === 0 ? undefined : targets
}

// Each command object parses one argv slice and is then discarded, so the
// parser extends its own accumulator instead of copying it per target.
function collectTarget(value: string, previous: string[] | undefined): string[] {
  if (previous === undefined) return [value]
  previous.push(value)
  return previous
}

interface NewGameOptions {
  deck?: string
  stake?: number
  seed?: string
  challenge?: string
}

function newGameInput(command: Command): Record<string, unknown> {
  const { deck, stake, seed, challenge } = command.opts<NewGameOptions>()
  return {
    ...(deck === undefined ? {} : { deck }),
    ...(stake === undefined ? {} : { stake }),
    ...(seed === undefined ? {} : { seed }),
    ...(challenge === undefined ? {} : { challenge }),
  }
}

const NO_ARGUMENT_SPEC: ActionSpec = { input: () => ({}) }

const CARD_ID_SPEC: ActionSpec = {
  argument: { syntax: "<card-id>", description: CARD_ID_DESCRIPTION },
  input: (command) => ({ card_id: command.args[0] }),
}

const TARGETED_CARD_SPEC: ActionSpec = {
  argument: { syntax: "<card-id>", description: CARD_ID_DESCRIPTION },
  configure: (command) =>
    command.addOption(
      new Option("--target <card-id>", TARGET_DESCRIPTION).argParser<string[] | undefined>(
        collectTarget,
      ),
    ),
  input: (command) => ({ card_id: command.args[0], targets: targetsOf(command) }),
}

// Only catalog actions whose CLI binding needs an argument or flag appear here.
// The catalog stays the single source of the command list, titles,
// descriptions, validation, and execution; unlisted actions take no arguments.
const ACTION_SPECS: Partial<Record<GameCommand, ActionSpec>> = {
  sell_card: CARD_ID_SPEC,
  buy_card: CARD_ID_SPEC,
  buy_voucher: CARD_ID_SPEC,
  buy_booster: CARD_ID_SPEC,
  select_hand_cards: {
    argument: {
      syntax: "[card-id...]",
      description: "Hand card IDs to highlight. Omit to clear the selection.",
    },
    input: (command) => ({ card_ids: command.args }),
  },
  sort_hand: {
    configure: (command) =>
      command.addOption(
        new Option("--order <rank|suit>", "Sort by rank or suit.").makeOptionMandatory(),
      ),
    input: (command) => ({ order: command.opts<{ order?: string }>().order }),
  },
  reorder_hand: {
    argument: {
      syntax: "<card-id...>",
      description: "Every current hand card ID, left to right.",
    },
    input: (command) => ({ order: command.args }),
  },
  use_consumable: TARGETED_CARD_SPEC,
  buy_consumable: {
    argument: { syntax: "<card-id>", description: CARD_ID_DESCRIPTION },
    configure: (command) => {
      command.option("--use", "Apply the consumable immediately instead of storing it.")
      command.addOption(
        new Option("--target <card-id>", TARGET_DESCRIPTION).argParser<string[] | undefined>(
          collectTarget,
        ),
      )
    },
    input: (command) => ({
      card_id: command.args[0],
      use: command.opts<{ use?: boolean }>().use === true,
      targets: targetsOf(command),
    }),
  },
  select_booster_card: TARGETED_CARD_SPEC,
  reorder_jokers: {
    argument: {
      syntax: "<card-id...>",
      description: "Every current joker card ID, left to right.",
    },
    input: (command) => ({ order: command.args }),
  },
  new_game: {
    configure: (command) => {
      command
        .option("--deck <key>", "Deck key for a normal run, e.g. b_red.")
        .option("--stake <1-8>", "Stake difficulty for a normal run.", parseDecimal)
        .option("--seed <seed>", "Seed for a normal run.")
        .option("--challenge <id>", "Challenge id for a challenge run.")
    },
    input: newGameInput,
  },
}

const resourceCatalogs = new WeakMap<BridgeClient, readonly ResourceDefinition[]>()

// The catalog is read-only and process-wide, so build it on first use and share
// it across one-shot commands and every REPL line on the same bridge.
function resourceCatalog(bridge: BridgeClient): readonly ResourceDefinition[] {
  const cached = resourceCatalogs.get(bridge)
  if (cached !== undefined) return cached
  const catalog = createResources(bridge)
  resourceCatalogs.set(bridge, catalog)
  return catalog
}

function addDocumentationPointer(command: Command): void {
  command.addHelpText("after", `\n${DOCUMENTATION}`)
}

function addActionCommand(
  parent: Command,
  action: GameAction,
  spec: ActionSpec,
  context: ProgramContext,
): void {
  const command = parent
    .command(action.command.replaceAll("_", "-"))
    .summary(action.title)
    .description(action.description)
  if (spec.argument !== undefined) {
    command.argument(spec.argument.syntax, spec.argument.description)
  }
  spec.configure?.(command)
  addDocumentationPointer(command)
  command.action(async function (this: Command): Promise<void> {
    const input = { ...spec.input(this), instance_index: context.instance(this) }
    const result = await action.execute(context.bridge, input)
    context.setStatus(printToolResult(result, context.json(this)))
  })
}

function addToolCommand(
  parent: Command,
  name: string,
  description: string,
  configure: (command: Command) => void,
  invoke: (command: Command) => Promise<CallToolResult>,
  context: ProgramContext,
): Command {
  const command = parent.command(name).description(description)
  configure(command)
  addDocumentationPointer(command)
  command.action(async function (this: Command): Promise<void> {
    context.setStatus(printToolResult(await invoke(this), context.json(this)))
  })
  return command
}

function addGroup(
  parent: Command,
  name: string,
  description: string,
  context: ProgramContext,
): Command {
  const group = parent.command(name).description(description).helpCommand(false)
  addDocumentationPointer(group)
  group.action(function (this: Command): void {
    this.outputHelp()
    context.setStatus(0)
  })
  return group
}

function addConnectionCommands(program: Command, context: ProgramContext): void {
  addToolCommand(
    program,
    "connect",
    "Open a session with a live instance and report its phase.",
    () => {},
    (command) =>
      connectGame(
        context.bridge,
        instanceIndexInputSchema.parse({ instance_index: context.instance(command) }),
      ),
    context,
  )
  addToolCommand(
    program,
    "disconnect",
    "Close this process's session with a live instance.",
    () => {},
    (command) =>
      disconnectGame(
        context.bridge,
        instanceIndexInputSchema.parse({ instance_index: context.instance(command) }),
      ),
    context,
  )
}

function addReadCommand(program: Command, bridge: BridgeClient, context: ProgramContext): void {
  const command = program
    .command("read")
    .description("Read any exposed resource by URI.")
    .argument("<uri>", "Resource URI, such as balatro://instances/0/turn.")
    .addHelpText("after", "The URI selects the target; --instance does not apply to reads.")
  addDocumentationPointer(command)
  command.action(async function (this: Command): Promise<void> {
    const result = await readResource(resourceCatalog(bridge), this.args[0] ?? "")
    context.setStatus(printResourceResult(result, context.json(this)))
  })
}

function addWikiCommand(program: Command, context: ProgramContext): void {
  const wiki = addGroup(program, "wiki", "Search the Balatro Wiki.", context)
  addToolCommand(
    wiki,
    "search",
    "Search the Balatro Wiki for matching pages.",
    (command) => {
      command
        .argument("<query>", "Search keyword or phrase.")
        .option("--limit <1-20>", "Maximum number of results, 1-20. Default 10.", parseDecimal)
    },
    (command) => {
      const { limit } = command.opts<{ limit?: number }>()
      return runWikiSearch(
        wikiSearchInputSchema.parse({
          query: command.args[0],
          ...(limit === undefined ? {} : { limit }),
        }),
      )
    },
    context,
  )
}

function addPostgameCommand(program: Command, context: ProgramContext): void {
  const postgame = addGroup(
    program,
    "postgame",
    "Write post-game analyses; read them with `read postgame://`.",
    context,
  )
  addToolCommand(
    postgame,
    "new",
    "Store a Markdown post-game analysis.",
    (command) => {
      command
        .requiredOption(
          "--title <text>",
          "Short title naming the run, its strategy, and its outcome.",
        )
        .requiredOption(
          "--summary <text>",
          "One or two sentences on the strategy and when it would be valuable.",
        )
        .requiredOption("--content <text>", "Markdown analysis of the run.")
    },
    (command) => {
      const { title, summary, content } = command.opts<{
        title?: string
        summary?: string
        content?: string
      }>()
      return writePostgame(newPostgameInputSchema.parse({ title, summary, content }))
    },
    context,
  )
}

function addReplCommand(program: Command, context: ProgramContext): void {
  const command = program
    .command("repl")
    .description("Run commands interactively in one process; leave with exit or Ctrl-D.")
  addDocumentationPointer(command)
  command.action(async function (this: Command): Promise<void> {
    const json = context.json(this)
    const defaultInstance = context.instance(this)
    await runRepl(
      (args) => runCli(context.bridge, args, { json, defaultInstance, repl: false }),
      json,
    )
    context.setStatus(0)
  })
}

export function createProgram(bridge: BridgeClient, options: CliOptions = {}): CliProgram {
  let status = 0
  const program = new Command()

  program
    .name(CLI_NAME)
    .description(
      "Play Balatro from the command line with the same live resources and validated actions as the MCP server.",
    )
    .version(packageJson.version, "-V, --version", "Print the package version.")
    .helpCommand(false)
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({
      // printCliError owns diagnostics; help and version still write to stdout.
      outputError: () => {},
      writeErr: () => {},
    })
    .exitOverride()
    .option("-i, --instance <index>", INSTANCE_DESCRIPTION, parseDecimal)
    .option("--json", JSON_DESCRIPTION)
  addDocumentationPointer(program)

  const context: ProgramContext = {
    bridge,
    setStatus: (value) => {
      status = value
    },
    json: (command) =>
      options.json === true || command.optsWithGlobals<{ json?: boolean }>().json === true,
    instance: (command) =>
      command.optsWithGlobals<{ instance?: number }>().instance ?? options.defaultInstance,
  }

  for (const action of gameActions) {
    addActionCommand(program, action, ACTION_SPECS[action.command] ?? NO_ARGUMENT_SPEC, context)
  }
  addConnectionCommands(program, context)
  addReadCommand(program, bridge, context)
  addWikiCommand(program, context)
  addPostgameCommand(program, context)
  if (options.repl !== false) addReplCommand(program, context)

  return { command: program, status: () => status }
}

/** Parses one argv slice and returns the status the process should exit with. */
export async function runCli(
  bridge: BridgeClient,
  args: readonly string[],
  options: CliOptions = {},
): Promise<number> {
  const cli = createProgram(bridge, options)
  try {
    await cli.command.parseAsync([...args], { from: "user" })
    return cli.status()
  } catch (error) {
    // Commander reports a bare invocation as an error-exit help request; the
    // CLI prints that help normally and treats it as success.
    if (error instanceof CommanderError && error.code === "commander.help") {
      cli.command.outputHelp()
      return 0
    }
    const json =
      options.json === true ||
      cli.command.opts<{ json?: boolean }>().json === true ||
      jsonRequested(args)
    return printCliError(error, json)
  }
}
