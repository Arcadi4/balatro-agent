import { expect, test } from "bun:test"

import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { readLiveResourceUri, registerLiveResources } from "./live.js"

test("registers all live resources without tools", () => {
  const registeredResources: string[] = []
  const tools: string[] = []
  const server = {
    registerResource(name: string) {
      registeredResources.push(name)
    },
    registerTool(name: string) {
      tools.push(name)
    },
  } as unknown as McpServer

  registerLiveResources(server, {} as BridgeClient)

  expect(registeredResources).toContain("turn")
  expect(registeredResources).toContain("hand")
  expect(registeredResources).toContain("jokers")
  expect(registeredResources).toContain("consumables")
  expect(registeredResources).toContain("deck")
  expect(registeredResources).toContain("shop")
  expect(registeredResources).toContain("booster")
  expect(registeredResources).toContain("run")
  expect(registeredResources).toContain("ante")
  expect(tools).toEqual([])
})

test("reads live resource by URI when in a run", async () => {
  const bridge = {
    getState: async () => ({
      phase: "SELECTING_HAND",
      ante: 1,
      money: 4,
      hands: 4,
      discards: 3,
      hand: [],
      jokers: [],
      consumables: [],
    }),
  } as unknown as BridgeClient

  const result = await readLiveResourceUri(bridge, "balatro://turn")
  expect(result).toBeDefined()
  expect(result?.uri).toBe("balatro://turn")
  expect(result?.markdown).toContain("# Turn")
})

test("fails with UNAVAILABLE when reading live resource during menu phase", async () => {
  const bridge = {
    getState: async () => ({
      phase: "MENU",
    }),
  } as unknown as BridgeClient

  expect(readLiveResourceUri(bridge, "balatro://turn")).rejects.toThrow("Balatro is not in a run")
})
