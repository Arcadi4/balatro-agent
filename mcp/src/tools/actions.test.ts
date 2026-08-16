import { expect, test } from "bun:test"

import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { registerActionTools } from "./actions.js"

test("registers and dispatches boss rerolls", async () => {
  let reroll: (() => Promise<unknown>) | undefined
  const server = {
    registerTool(name: string, _config: unknown, callback: () => Promise<unknown>) {
      if (name === "balatro_reroll_boss") reroll = callback
    },
  } as unknown as McpServer
  const bridge = {
    command: async (kind: string, args: unknown) => {
      expect(kind).toBe("reroll_boss")
      expect(args).toBeUndefined()
      return { rerolled: true, previous_boss: "bl_fish", cost: 10 }
    },
  } as unknown as BridgeClient

  registerActionTools(server, bridge)
  expect(reroll).toBeDefined()
  await reroll?.()
})
