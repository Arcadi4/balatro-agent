import { createInterface } from "node:readline"

import { split } from "shlex"

import { printCliError } from "./output.js"

const PROMPT = "balatro> "

/**
 * Runs commands from stdin until `exit` or EOF.
 *
 * Lines are split with shell quoting rules and handed to `runLine` one at a
 * time; nothing is expanded or executed by a child shell. A failing command or
 * an unterminated quote is reported and the session continues. Piped input and
 * --json never see a prompt; an interactive human terminal gets one.
 */
export async function runRepl(
  runLine: (args: string[]) => Promise<number>,
  json: boolean,
): Promise<void> {
  const interactive = !json && process.stdin.isTTY === true && process.stdout.isTTY === true
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  })
  rl.on("error", (error: unknown) => {
    printCliError(error, json)
  })
  if (interactive) {
    rl.setPrompt(PROMPT)
    rl.prompt()
  }

  try {
    for await (const raw of rl) {
      const line = raw.trim()
      if (line === "") {
        if (interactive) rl.prompt()
        continue
      }
      let args: string[]
      try {
        args = split(line)
      } catch (error) {
        printCliError(
          {
            error_code: "USAGE_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
          json,
        )
        if (interactive) rl.prompt()
        continue
      }
      if (args.length === 1 && args[0] === "exit") break
      try {
        await runLine(args)
      } catch (error) {
        printCliError(error, json)
      }
      if (interactive) rl.prompt()
    }
  } catch (error) {
    printCliError(error, json)
  } finally {
    rl.close()
  }
}
