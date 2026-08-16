import { expect, test } from "bun:test"

import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { registerInspectGameState } from "./inspectGameState.js"

test("renders face-down cards without hidden details", async () => {
  let inspect: (() => Promise<unknown>) | undefined
  const server = {
    registerTool(name: string, _config: unknown, callback: () => Promise<unknown>) {
      if (name === "balatro_inspect_game_state") inspect = callback
    },
  } as unknown as McpServer
  const bridge = {
    getState: async () => ({
      hand: [
        {
          card_id: "hidden-card-1",
          kind: "playing_card",
          faced_down: true,
        },
      ],
      jokers: [
        {
          card_id: "hidden-card-2",
          kind: "joker",
          faced_down: true,
        },
      ],
      round: {
        chips_scored: 0,
        blind: {
          name: "The Arm",
          chips: 10_000,
          description: "Decreases level of played poker hand",
        },
      },
      blind_select: {
        current: "Boss",
        boss_reroll_cost: 10,
        blinds: [
          {
            slot: "Boss",
            name: "The Fish",
            chips: 22_000,
            description: "Cards drawn face down after each hand played",
          },
        ],
      },
    }),
  } as unknown as BridgeClient

  registerInspectGameState(server, bridge)
  expect(inspect).toBeDefined()
  const result = (await inspect?.()) as {
    content: Array<{ type: string; text: string }>
    structuredContent: { payload: Record<string, unknown> }
  }
  const markdown = result.content.find((entry) => entry.type === "text")?.text

  expect(markdown).toContain("[hidden-card-1] Face-down card")
  expect(markdown).toContain("[hidden-card-2] Face-down Joker")
  expect(markdown).toContain("Decreases level of played poker hand")
  expect(markdown).toContain("Cards drawn face down after each hand played")
  expect(markdown).toContain("Boss reroll:** $10")
  const hiddenHand = (result.structuredContent.payload.hand as Array<Record<string, unknown>>)[0]
  const hiddenJoker = (result.structuredContent.payload.jokers as Array<Record<string, unknown>>)[0]
  expect(hiddenHand).toEqual({
    card_id: "hidden-card-1",
    kind: "playing_card",
    faced_down: true,
  })
  expect(hiddenJoker).toEqual({
    card_id: "hidden-card-2",
    kind: "joker",
    faced_down: true,
  })
})
