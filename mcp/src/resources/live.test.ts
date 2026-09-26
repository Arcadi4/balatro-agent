import { expect, test } from "bun:test"

import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { readLiveResourceUri, registerLiveResources } from "./live.js"

test("registers unscoped live resources and the instance template without tools", () => {
  const registeredResources: Array<{ name: string; uri: string }> = []
  const tools: string[] = []
  const server = {
    registerResource(name: string, uri: string) {
      registeredResources.push({ name, uri })
      return { enable() {}, disable() {} }
    },
    registerTool(name: string) {
      tools.push(name)
    },
  } as unknown as McpServer

  registerLiveResources(server, {} as BridgeClient)

  const names = registeredResources.map((resource) => resource.name)
  for (const section of [
    "turn",
    "hand",
    "jokers",
    "consumables",
    "deck",
    "shop",
    "booster",
    "run",
    "ante",
  ]) {
    expect(names).toContain(`${section}-selected`)
  }
  expect(names).toContain("instances")
  expect(names).toContain("live")
  expect(tools).toEqual([])
})

test("reads live resource by URI when in a run", async () => {
  const bridge = {
    getSelectedInstanceId: () => "instance-1",
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
    getSelectedInstanceId: () => "instance-1",
    getState: async () => ({
      phase: "MENU",
    }),
  } as unknown as BridgeClient

  expect(readLiveResourceUri(bridge, "balatro://turn")).rejects.toThrow("Balatro is not in a run")
})
