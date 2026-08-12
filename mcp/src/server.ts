import { join } from "node:path"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import type { Deps } from "./deps.js"
import { registerAllPrompts } from "./prompts/index.js"
import { registerAllResources } from "./resources/index.js"
import { registerAllTools } from "./tools/index.js"

const SERVER_NAME = "balatro-mcp-server"

async function readPackageVersion(): Promise<string> {
  // `import.meta.dir` is the directory of this file whether running from
  // src/ or a bundled dist/ (both sit one level below the package root).
  const candidates = [
    join(import.meta.dir, "..", "package.json"),
    join(import.meta.dir, "..", "..", "package.json"),
  ]

  for (const candidate of candidates) {
    const file = Bun.file(candidate)
    if (!(await file.exists())) continue
    try {
      const parsed = (await file.json()) as { name?: string; version?: string }
      if (parsed.name === SERVER_NAME && typeof parsed.version === "string") {
        return parsed.version
      }
    } catch {
      continue
    }
  }

  return "0.0.0"
}

export interface CreateServerOptions {
  deps: Deps
}

export async function createServer(options: CreateServerOptions): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: await readPackageVersion(),
  })

  registerAllTools(server, options.deps)
  registerAllResources(server, options.deps)
  registerAllPrompts(server, options.deps)

  return server
}

export interface RunServerOptions {
  deps: Deps
  flushBridge?: () => Promise<void>
}

type ShutdownSignal = "SIGINT" | "SIGTERM"

export async function runServer(options: RunServerOptions): Promise<void> {
  const server = await createServer({ deps: options.deps })
  const transport = new StdioServerTransport()

  let shuttingDown = false
  const shutdown = async (signal: ShutdownSignal): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    process.stderr.write(`[balatro-mcp-server] received ${signal}, shutting down\n`)
    try {
      if (options.flushBridge) await options.flushBridge()
    } catch (err) {
      process.stderr.write(`[balatro-mcp-server] flushBridge failed: ${(err as Error).message}\n`)
    }
    try {
      await server.close()
    } catch (err) {
      process.stderr.write(`[balatro-mcp-server] server.close failed: ${(err as Error).message}\n`)
    }
    process.exit(0)
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT")
  })
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM")
  })

  await server.connect(transport)
  process.stderr.write(`[balatro-mcp-server] connected on stdio\n`)
}
