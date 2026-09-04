#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import packageJson from "../package.json"
import { BridgeClient } from "./bridge/socket-client.js"
import { startHttpServer } from "./http.js"
import { registerHandbookPrompt } from "./prompts/handbook.js"
import { registerCardModifiersResource } from "./resources/cardModifiers.js"
import { registerChallengesResource } from "./resources/challenges.js"
import { registerDecksResource } from "./resources/decks.js"
import { registerLiveResources } from "./resources/live.js"
import { registerPostgameResource } from "./resources/postgame.js"
import { registerResourceReadTool } from "./resources/resource-tools.js"
import { registerWikiResource } from "./resources/wiki.js"
import { registerAllTools } from "./tools/index.js"

const LIST_CACHE_HINT = { ttlMs: 60_000, cacheScope: "public" } as const

function createServer(bridge: BridgeClient, resourceTools = false): McpServer {
  const server = new McpServer(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
    },
    {
      instructions:
        "Read balatro:// resources (turn, hand, jokers, consumables, deck, shop, booster, run, ante) before acting; balatro://turn is a superset of the per-section reads. Use the balatro_play_handbook prompt for live-play guidance and the Balatro Wiki to verify relevant rules; stored analyses are listed at postgame://.",
      cacheHints: {
        "server/discover": LIST_CACHE_HINT,
        "tools/list": LIST_CACHE_HINT,
        "prompts/list": LIST_CACHE_HINT,
        "resources/list": LIST_CACHE_HINT,
      },
    },
  )

  registerAllTools(server, bridge)
  registerCardModifiersResource(server)
  registerChallengesResource(server)
  registerDecksResource(server)
  registerLiveResources(server, bridge)
  registerWikiResource(server)
  registerPostgameResource(server)
  if (resourceTools) {
    registerResourceReadTool(server, bridge)
  }
  registerHandbookPrompt(server)
  return server
}

type CommandLineOptions =
  | { transport: "stdio"; resourceTools: boolean }
  | {
      transport: "http"
      port: number
      parentPid?: number
      statusFile?: string
      resourceTools: boolean
    }

function requiredInteger(
  value: string | undefined,
  flag: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

function parseCommandLine(args: string[]): CommandLineOptions {
  let transport: CommandLineOptions["transport"] = "stdio"
  let port: number | undefined
  let parentPid: number | undefined
  let statusFile: string | undefined
  let resourceTools = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--transport") {
      const value = args[index + 1]
      if (value !== "stdio" && value !== "http")
        throw new Error("--transport must be stdio or http")
      transport = value
      index += 1
    } else if (argument === "--port") {
      port = requiredInteger(args[index + 1], "--port", 1, 65_535)
      index += 1
    } else if (argument === "--parent-pid") {
      parentPid = requiredInteger(args[index + 1], "--parent-pid", 1, Number.MAX_SAFE_INTEGER)
      index += 1
    } else if (argument === "--resource-tools") {
      resourceTools = true
    } else if (argument === "--status-file") {
      const value = args[index + 1]
      if (value === undefined || value.length === 0)
        throw new Error("--status-file requires a path")
      statusFile = value
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (transport === "http") {
    if (port === undefined) throw new Error("--port is required for HTTP transport")
    return { transport, port, parentPid, statusFile, resourceTools }
  }
  if (port !== undefined || parentPid !== undefined || statusFile !== undefined) {
    throw new Error("--port, --parent-pid, and --status-file require --transport http")
  }
  return { transport, resourceTools }
}

async function main(): Promise<void> {
  const options = parseCommandLine(process.argv.slice(2))
  const bridge = new BridgeClient()
  const onerror = (error: Error) => process.stderr.write(`[balatro-mcp] ${error.message}\n`)
  if (options.transport === "http") {
    const server = await startHttpServer({
      createServer: (httpBridge) => createServer(httpBridge, options.resourceTools),
      bridge,
      port: options.port,
      parentPid: options.parentPid,
      statusFile: options.statusFile,
      onerror,
    })
    const shutdown = () => void server.stop()
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
    return
  }

  bridge.connect().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[balatro-mcp] bridge not connected yet: ${message}\n`)
  })
  const handle = serveStdio(() => createServer(bridge, options.resourceTools), { onerror })
  let closing = false
  const shutdown = async (signal?: string): Promise<void> => {
    if (closing) return
    closing = true
    if (signal) process.stderr.write(`[balatro-mcp] received ${signal}\n`)
    try {
      await handle.close()
    } finally {
      await bridge.dispose()
    }
  }
  process.once("SIGINT", () => void shutdown("SIGINT"))
  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.stdin.once("end", () => void shutdown())
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`[balatro-mcp] fatal: ${message}\n`)
  process.exitCode = 1
})
