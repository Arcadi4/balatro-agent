#!/usr/bin/env bun

import {
  isJSONRPCNotification,
  isJSONRPCRequest,
  JSONRPC_VERSION,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  UnsupportedProtocolVersionError,
} from "@modelcontextprotocol/server"
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio"

import packageJson from "../package.json"
import { BridgeClient } from "./bridge/socket-client.js"
import { autoContextEnabled } from "./flags.js"
import { registerHandbookPrompt } from "./prompts/handbook.js"
import { registerCardModifiersResource } from "./resources/cardModifiers.js"
import { registerChallengesResource } from "./resources/challenges.js"
import { registerDecksResource } from "./resources/decks.js"
import { registerLiveResources } from "./resources/live.js"
import { registerPostgameResource } from "./resources/postgame.js"
import { registerStakesResource } from "./resources/stakes.js"
import { registerWikiResource } from "./resources/wiki.js"
import { registerAllTools } from "./tools/index.js"

// SDK v2.0.0 skips version checks after pinning stdio; its modern version list is internal.
const SUPPORTED_MODERN_PROTOCOL_VERSIONS: readonly string[] = ["2026-07-28"]

class VersionGatedStdioTransport extends StdioServerTransport {
  override async start(): Promise<void> {
    const onmessage = this.onmessage
    this.onmessage = (message) => {
      if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) {
        onmessage?.(message)
        return
      }
      const meta: unknown = message.params?._meta
      const claimed =
        typeof meta === "object" && meta !== null
          ? (meta as Record<string, unknown>)[PROTOCOL_VERSION_META_KEY]
          : undefined
      if (typeof claimed !== "string" || SUPPORTED_MODERN_PROTOCOL_VERSIONS.includes(claimed)) {
        onmessage?.(message)
        return
      }
      const error = new UnsupportedProtocolVersionError({
        supported: [...SUPPORTED_MODERN_PROTOCOL_VERSIONS],
        requested: claimed,
      })
      this.onerror?.(error)
      if (!isJSONRPCRequest(message)) return
      void this.send({
        jsonrpc: JSONRPC_VERSION,
        id: message.id,
        error: { code: error.code, message: error.message, data: error.data },
      }).catch((cause: unknown) => {
        this.onerror?.(cause instanceof Error ? cause : new Error(String(cause)))
      })
    }
    await super.start()
  }
}

const LIST_CACHE_HINT = { ttlMs: 60_000, cacheScope: "public" } as const

const LIVE_LIST_CACHE_HINT = { ttlMs: 1_000, cacheScope: "public" } as const

// The auto-context feed changes what an action result carries, so the client
// instructions have to describe the mode the server actually runs in.
const AUTO_CONTEXT_GUIDANCE =
  "After an action the response carries a '## Next' snapshot of the next decision surface, so prefer it over re-reading."
const NO_AUTO_CONTEXT_GUIDANCE =
  "After an action, re-read the target instance's turn resource for the next decision surface: no snapshot follows the response."

const INSTANCE_TARGETING_GUIDANCE =
  "Read balatro://instances for live instances numbered oldest-first from 0. Indices are recomputed on discovery " +
  "and can shift when instances appear or exit. Pass instance_index on tools and use balatro://instances/<index>/<section> " +
  "for resources. Actions and resources open IPC connections on demand; connect is optional and does not select a default. " +
  "Omit instance_index or use an unscoped live resource only when exactly one live instance exists. With multiple instances, " +
  "bare requests fail before acting with INSTANCE_SELECTION_REQUIRED and the current numbered list; retry with an index. " +
  "With no live instances, requests return GAME_NOT_RUNNING. Read the target's turn resource before the first action " +
  "for its phase, round, legal actions, hand, jokers, and consumables. "

function createServer(bridge: BridgeClient, autoContext: boolean): McpServer {
  const server = new McpServer(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
    },
    {
      instructions:
        INSTANCE_TARGETING_GUIDANCE +
        (autoContext
          ? `${AUTO_CONTEXT_GUIDANCE} The snapshot's URIs already carry the instance_index it was read from, so follow them as written. `
          : `${NO_AUTO_CONTEXT_GUIDANCE} `) +
        "Use the balatro_play_handbook prompt for live-play strategy and balatro_wiki_search to verify rules. " +
        "When a run ends, ask the user before recording an analysis with new_postgame; stored analyses are listed at postgame://.",
      cacheHints: {
        "server/discover": LIST_CACHE_HINT,
        "tools/list": LIST_CACHE_HINT,
        "prompts/list": LIST_CACHE_HINT,
        "resources/templates/list": LIST_CACHE_HINT,
        "resources/list": LIVE_LIST_CACHE_HINT,
      },
    },
  )

  registerAllTools(server, bridge)
  registerCardModifiersResource(server)
  registerChallengesResource(server)
  registerDecksResource(server)
  registerStakesResource(server)
  registerLiveResources(server, bridge)
  registerWikiResource(server)
  registerPostgameResource(server)
  registerHandbookPrompt(server)
  return server
}

async function main(): Promise<void> {
  const bridge = new BridgeClient()
  const autoContext = autoContextEnabled()

  const reportError = (error: Error): void => {
    process.stderr.write(`[balatro-mcp] ${error.message}\n`)
  }

  const handle = serveStdio(() => createServer(bridge, autoContext), {
    transport: new VersionGatedStdioTransport(),
    onerror: reportError,
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

if (Bun.argv.includes("--version")) {
  console.log(`${packageJson.name} ${packageJson.version}`)
} else {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`[balatro-mcp] fatal: ${message}\n`)
    process.exitCode = 1
  })
}
