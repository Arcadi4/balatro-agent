#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import packageJson from "../package.json"
import { BridgeClient } from "./bridge/socket-client.js"
import { GameGate } from "./gate.js"
import { registerHandbookPrompt } from "./prompts/handbook.js"
import { registerCardModifiersResource } from "./resources/cardModifiers.js"
import { registerChallengesResource } from "./resources/challenges.js"
import { registerDecksResource } from "./resources/decks.js"
import { registerLiveResources } from "./resources/live.js"
import { registerPostgameResource } from "./resources/postgame.js"
import { registerStakesResource } from "./resources/stakes.js"
import { registerWikiResource } from "./resources/wiki.js"
import { registerAllTools } from "./tools/index.js"

const LIST_CACHE_HINT = { ttlMs: 60_000, cacheScope: "public" } as const

function createServer(bridge: BridgeClient, gate: GameGate): McpServer {
  const server = new McpServer(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
    },
    {
      instructions:
        "Call connect first: live-play tools and balatro:// resources stay hidden until the game bridge is attached, and a busy game rejects the connection (INSTANCE_BUSY). Read balatro://turn before acting; it is a superset of the per-section reads. Use the balatro_play_handbook prompt for live-play guidance and the Balatro Wiki to verify relevant rules. When a run ends, ask the user whether to record a post-game analysis with new_postgame; stored analyses are listed at postgame://.",
      cacheHints: {
        "server/discover": LIST_CACHE_HINT,
        "tools/list": LIST_CACHE_HINT,
        "prompts/list": LIST_CACHE_HINT,
        "resources/list": LIST_CACHE_HINT,
      },
    },
  )

  registerAllTools(server, bridge, gate)
  registerCardModifiersResource(server)
  registerChallengesResource(server)
  registerDecksResource(server)
  registerStakesResource(server)
  registerLiveResources(server, bridge, gate)
  registerWikiResource(server)
  registerPostgameResource(server)
  registerHandbookPrompt(server)
  // A new MCP session over a bridge that is already attached starts with
  // the live surface enabled; otherwise everything game-bound stays hidden.
  gate.sync(bridge.isConnected())
  return server
}

async function main(): Promise<void> {
  const bridge = new BridgeClient()
  const gate = new GameGate()
  bridge.onDisconnect = () => gate.disable()

  const handle = serveStdio(() => createServer(bridge, gate), {
    onerror: (error) => process.stderr.write(`[balatro-mcp] ${error.message}\n`),
  })

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
