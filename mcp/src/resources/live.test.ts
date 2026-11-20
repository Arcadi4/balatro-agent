import { expect, test } from "bun:test"

import type { BridgeClient } from "../bridge/socket-client.js"
import { liveResources, readLiveResourceUri } from "./live.js"

test("builds unscoped live resources and the instance template", () => {
  const resources = liveResources({} as BridgeClient, async () => [])
  const names = resources.map((resource) => resource.name)
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
    expect(names).toContain(`${section}-single`)
  }
  expect(names).toContain("instances")
  expect(names).toContain("live")
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
