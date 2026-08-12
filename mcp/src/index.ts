import { BridgeClient } from "./bridge/socket-client.js"
import type { Deps } from "./deps.js"
import { getRulesContent } from "./resources/rules.js"
import { runServer } from "./server.js"

async function main(): Promise<void> {
  const bridgeClient = new BridgeClient()
  await bridgeClient.connect()

  const deps: Deps = {
    bridgeClient,
    rulesService: {
      async getGlobalRules() {
        return { markdown: getRulesContent() }
      },
    },
  }

  await runServer({
    deps,
    flushBridge: async () => {
      await bridgeClient.dispose()
    },
  })
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[balatro-mcp-server] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`,
  )
  process.exit(1)
})
