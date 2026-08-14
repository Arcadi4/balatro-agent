import { McpServer } from "@modelcontextprotocol/server"
import { serveStdio } from "@modelcontextprotocol/server/stdio"

import packageJson from "../package.json"
import { BridgeClient } from "./bridge/socket-client.js"
import { registerStrategyPrompt } from "./prompts/strategy.js"
import { registerCardModifiersResource } from "./resources/cardModifiers.js"
import { registerChallengesResource } from "./resources/challenges.js"
import { registerDecksResource } from "./resources/decks.js"
import { registerRulesResource } from "./resources/rules.js"
import { registerAllTools } from "./tools/index.js"

const LIST_CACHE_HINT = { ttlMs: 60_000, cacheScope: "public" } as const

function createServer(bridge: BridgeClient): McpServer {
  const server = new McpServer(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
    },
    {
      instructions:
        "Inspect the live game state before acting. Static game rules are available as balatro://rules or through the balatro_strategy_context prompt.",
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
  registerRulesResource(server)
  registerStrategyPrompt(server)
  return server
}

async function main(): Promise<void> {
  const bridge = new BridgeClient()
  try {
    await bridge.connect()
  } catch (error) {
    await bridge.dispose()
    throw error
  }

  const handle = serveStdio(() => createServer(bridge), {
    onerror: (error) => process.stderr.write(`[balatro-mcp-server] ${error.message}\n`),
  })

  let closing = false
  const shutdown = async (signal?: string): Promise<void> => {
    if (closing) return
    closing = true
    if (signal) process.stderr.write(`[balatro-mcp-server] received ${signal}\n`)
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
  process.stderr.write(`[balatro-mcp-server] fatal: ${message}\n`)
  process.exitCode = 1
})
