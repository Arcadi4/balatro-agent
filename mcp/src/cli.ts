#!/usr/bin/env bun

import { BridgeClient } from "./bridge/socket-client.js"
import { printCliError } from "./cli/output.js"
import { jsonRequested, runCli } from "./cli/program.js"

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const bridge = new BridgeClient()
  let status = 0
  try {
    status = await runCli(bridge, args)
  } catch (error) {
    status = printCliError(error, jsonRequested(args))
  } finally {
    await bridge.dispose()
  }
  process.exitCode = status
}

await main()
