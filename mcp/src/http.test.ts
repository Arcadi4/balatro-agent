import { expect, test } from "bun:test"
import { createServer } from "node:http"

import { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "./bridge/socket-client.js"
import { createHttpHandler, startHttpServer } from "./http.js"

function handler(): (request: Request) => Promise<Response> {
  const http = createHttpHandler(
    () => new McpServer({ name: "test", version: "1.0.0" }),
    {} as BridgeClient,
    () => undefined,
  )
  return http.fetch
}

test("rejects non-loopback hosts before dispatch", async () => {
  const response = await handler()(
    new Request("http://127.0.0.1:52745/mcp", {
      headers: { Host: "attacker.example" },
    }),
  )

  expect(response.status).toBe(403)
})

test("allows browser-originated requests", async () => {
  const response = await handler()(
    new Request("http://127.0.0.1:52745/mcp", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:52745",
        Origin: "https://chatgpt.com",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: "not json",
    }),
  )

  expect(response.status).toBe(400)
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
})

test("accepts browser private-network preflights", async () => {
  const response = await handler()(
    new Request("http://127.0.0.1:52745/mcp", {
      method: "OPTIONS",
      headers: {
        Host: "127.0.0.1:52745",
        Origin: "https://chatgpt.com",
        "Access-Control-Request-Private-Network": "true",
      },
    }),
  )

  expect(response.status).toBe(204)
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true")
})

test("rejects browser preflights with a non-loopback host", async () => {
  const response = await handler()(
    new Request("http://127.0.0.1:52745/mcp", {
      method: "OPTIONS",
      headers: { Host: "attacker.example", Origin: "https://attacker.example" },
    }),
  )

  expect(response.status).toBe(403)
})

test("does not expose routes other than the MCP endpoint", async () => {
  const response = await handler()(
    new Request("http://127.0.0.1:52745/", {
      headers: { Host: "127.0.0.1:52745" },
    }),
  )

  expect(response.status).toBe(404)
})

test("does not claim the game bridge when the HTTP port is occupied", async () => {
  const occupied = createServer()
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
  const address = occupied.address()
  if (address === null || typeof address === "string") throw new Error("Expected TCP address")

  let connected = false
  let disposed = false
  const bridge = {
    connect: async () => {
      connected = true
    },
    dispose: async () => {
      disposed = true
    },
  } as unknown as BridgeClient

  try {
    await expect(
      startHttpServer({
        bridge,
        createServer: () => new McpServer({ name: "test", version: "1.0.0" }),
        port: address.port,
        onerror: () => undefined,
      }),
    ).rejects.toThrow()
    expect(connected).toBe(false)
    expect(disposed).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
