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
 * The first failure determines the session's exit status.
 */
export async function runRepl(
  runLine: (args: string[]) => Promise<number>,
  json: boolean,
): Promise<number> {
  let status = 0
  const remember = (code: number): void => {
    status ||= code
  }
  const interactive = !json && process.stdin.isTTY === true && process.stdout.isTTY === true
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  })
  rl.on("error", (error: unknown) => {
    remember(printCliError(error, json))
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
        remember(
          printCliError(
            {
              error_code: "USAGE_ERROR",
              message: error instanceof Error ? error.message : String(error),
            },
            json,
          ),
        )
        if (interactive) rl.prompt()
        continue
      }
      if (args.length === 1 && args[0] === "exit") break
      try {
        remember(await runLine(args))
      } catch (error) {
        remember(printCliError(error, json))
      }
      if (interactive) rl.prompt()
    }
  } catch (error) {
    remember(printCliError(error, json))
  } finally {
    rl.close()
  }
  return status
}
