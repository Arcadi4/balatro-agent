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

test("returns played cards while preserving hidden-card redaction", async () => {
  let play: (() => Promise<unknown>) | undefined
  const server = {
    registerTool(name: string, _config: unknown, callback: () => Promise<unknown>) {
      if (name === "balatro_play_hand") play = callback
    },
  } as unknown as McpServer
  const bridge = {
    command: async () => ({
      cards_played: 2,
      played_cards: [{ faced_down: true }, { rank: "King", suit: "Hearts", enhancement: "mult" }],
    }),
  } as unknown as BridgeClient

  registerActionTools(server, bridge)
  const result = (await play?.()) as {
    content: Array<{ type: string; text: string }>
    structuredContent: { data: { played_cards: Array<Record<string, unknown>> } }
  }
  const markdown = result.content[0]?.text
  expect(markdown).toContain("Face-down card")
  expect(markdown).toContain("King of Hearts (mult)")
  expect(result.structuredContent.data.played_cards[0]).toEqual({ faced_down: true })
})
