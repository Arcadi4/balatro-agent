import { rename, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"

import { toNodeHandler } from "@modelcontextprotocol/node"
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  type McpServer,
} from "@modelcontextprotocol/server"

import type { BridgeClient } from "./bridge/socket-client.js"

const LOOPBACK_HOST = "127.0.0.1"
const MCP_PATH = "/mcp"
const LOOPBACK_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"]

export interface HttpServerOptions {
  createServer: (bridge: BridgeClient) => McpServer
  bridge: BridgeClient
  port: number
  parentPid?: number
  statusFile?: string
  onerror: (error: Error) => void
}

export interface HttpHandler {
  fetch(request: Request): Promise<Response>
  close(): Promise<void>
}

export interface RunningHttpServer {
  stop(): Promise<void>
}

export function createHttpHandler(
  createServer: (bridge: BridgeClient) => McpServer,
  bridge: BridgeClient,
  onerror: (error: Error) => void,
): HttpHandler {
  const handler = createMcpHandler(() => createServer(bridge), { onerror })

  return {
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== MCP_PATH)
        return new Response("Not Found", { status: 404 })
      const rejected = hostHeaderValidationResponse(request, LOOPBACK_HOSTNAMES)
      if (rejected) return rejected
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) })
      }
      const response = await handler.fetch(request)
      const headers = new Headers(response.headers)
      for (const [name, value] of corsHeaders(request)) headers.set(name, value)
      return new Response(response.body, { status: response.status, headers })
    },
    close: handler.close,
  }
}

function corsHeaders(request: Request): Headers {
  if (!request.headers.has("origin")) return new Headers()
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Accept, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
    "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
    "Access-Control-Allow-Origin": "*",
  })
  if (request.headers.has("Access-Control-Request-Private-Network")) {
    headers.set("Access-Control-Allow-Private-Network", "true")
  }
  return headers
}

async function writeStatus(statusFile: string | undefined, value: string): Promise<void> {
  if (statusFile === undefined) return
  const temporary = `${statusFile}.tmp`
  await writeFile(temporary, `${value.replaceAll(/[\r\n]/g, " ")}\n`)
  await rename(temporary, statusFile)
}

function listen(server: Server, port: number): Promise<void> {
  const { promise, reject, resolve } = Promise.withResolvers<void>()
  server.once("error", reject)
  server.listen(port, LOOPBACK_HOST, () => {
    server.off("error", reject)
    resolve()
  })
  return promise
}

function close(server: Server): Promise<void> {
  const { promise, reject, resolve } = Promise.withResolvers<void>()
  server.close((error) => (error ? reject(error) : resolve()))
  return promise
}

export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  let handler: HttpHandler | undefined
  let server: Server | undefined
  try {
    handler = createHttpHandler(options.createServer, options.bridge, options.onerror)
    const dispatch = toNodeHandler(handler)
    server = createServer((request, response) => {
      void dispatch(request, response).catch(options.onerror)
    })
    await listen(server, options.port)
    await options.bridge.connect()
    await writeStatus(options.statusFile, "ready")
    const runningHandler = handler
    const runningServer = server

    const parentPid = options.parentPid
    const parentMonitor =
      parentPid === undefined
        ? undefined
        : setInterval(() => {
            try {
              process.kill(parentPid, 0)
            } catch {
              void stop()
            }
          }, 1_000)
    let stopped = false

    async function stop(): Promise<void> {
      if (stopped) return
      stopped = true
      if (parentMonitor !== undefined) clearInterval(parentMonitor)
      await Promise.all([close(runningServer), runningHandler.close()])
      await options.bridge.dispose()
    }

    return { stop }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await Promise.all([
      server === undefined ? undefined : close(server),
      handler?.close(),
      options.bridge.dispose(),
    ])
    await writeStatus(options.statusFile, `error ${message}`)
    throw error
  }
}
