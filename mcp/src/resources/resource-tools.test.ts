import { expect, test } from "bun:test"

import type { McpServer } from "@modelcontextprotocol/server"

import { BridgeError, type BridgeClient } from "../bridge/socket-client.js"
import {
  executeReadResource,
  registerResourceReadTool,
  RESOURCE_TOOL_ANNOTATIONS,
} from "./resource-tools.js"

function mockBridge(state: Record<string, unknown> = {}): BridgeClient {
  return {
    getState: async () => ({
      phase: "SELECTING_HAND",
      ante: 1,
      money: 4,
      hands: 4,
      discards: 3,
      hand: [],
      jokers: [],
      consumables: [],
      ...state,
    }),
  } as unknown as BridgeClient
}

test("registers generic read resource tool with proper annotations", () => {
  let registeredToolName: string | undefined
  let registeredConfig: unknown

  const server = {
    registerTool(name: string, config: unknown) {
      registeredToolName = name
      registeredConfig = config
    },
  } as unknown as McpServer

  registerResourceReadTool(server, mockBridge())

  expect(registeredToolName).toBe("balatro_read_resource")
  expect(registeredConfig).toMatchObject({
    title: "Read Balatro Resource",
    annotations: RESOURCE_TOOL_ANNOTATIONS,
  })
  expect(RESOURCE_TOOL_ANNOTATIONS.readOnlyHint).toBe(true)
  expect(RESOURCE_TOOL_ANNOTATIONS.idempotentHint).toBe(true)
})

test("reads a single live resource URI", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["balatro://turn"])

  expect(result.isError).toBeUndefined()
  const structured = result.structuredContent as {
    results: Array<{ uri: string; markdown: string }>
  }
  expect(structured.results).toHaveLength(1)
  expect(structured.results[0]?.uri).toBe("balatro://turn")
  expect(structured.results[0]?.markdown).toContain("# Turn")
  const textContent = result.content[0] as { type: "text"; text: string }
  expect(textContent.text).toContain("# Turn")
})

test("reads multiple resource URIs in one call and combines outputs", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["balatro://turn", "balatro://decks"])

  expect(result.isError).toBeUndefined()
  const structured = result.structuredContent as {
    results: Array<{ uri: string; markdown: string }>
  }
  expect(structured.results).toHaveLength(2)
  expect(structured.results[0]?.uri).toBe("balatro://turn")
  expect(structured.results[1]?.uri).toBe("balatro://decks")
  expect(structured.results[1]?.markdown).toContain("Balatro Decks Reference")

  const textContent = result.content[0] as { type: "text"; text: string }
  const combinedText = textContent.text
  expect(combinedText).toContain("# Turn")
  expect(combinedText).toContain("---")
  expect(combinedText).toContain("Balatro Decks Reference")
})

test("reads card modifiers subresources", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, [
    "balatro://card_modifiers",
    "balatro://card_modifiers/enhancements",
  ])

  expect(result.isError).toBeUndefined()
  const structured = result.structuredContent as {
    results: Array<{ uri: string; markdown: string }>
  }
  expect(structured.results).toHaveLength(2)
  expect(structured.results[0]?.uri).toBe("balatro://card_modifiers")
  expect(structured.results[1]?.uri).toBe("balatro://card_modifiers/enhancements")
  expect(structured.results[1]?.markdown).toContain("Enhancement")
})

test("reads postgame listing resource", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["postgame://"])

  expect(result.isError).toBeUndefined()
  const structured = result.structuredContent as {
    results: Array<{ uri: string; markdown: string }>
  }
  expect(structured.results).toHaveLength(1)
  expect(structured.results[0]?.uri).toBe("postgame://")
  expect(structured.results[0]?.markdown).toContain("Post-Game")
})

test("rejects unsupported URI schemes with actionable error", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["https://example.com"])

  expect(result.isError).toBe(true)
  const structured = result.structuredContent as { error_code: string; message: string }
  expect(structured.error_code).toBe("INVALID_URI")
  expect(structured.message).toContain("Unsupported URI scheme")
})

test("rejects unknown balatro:// URIs with actionable error listing valid options", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["balatro://not_a_resource"])

  expect(result.isError).toBe(true)
  const structured = result.structuredContent as { error_code: string; message: string }
  expect(structured.error_code).toBe("INVALID_URI")
  expect(structured.message).toContain("Unknown Balatro resource URI")
  expect(structured.message).toContain("balatro://turn")
})

test("rejects live resource reads during MENU phase with UNAVAILABLE error", async () => {
  const bridge = mockBridge({ phase: "MENU" })
  const result = await executeReadResource(bridge, ["balatro://hand"])

  expect(result.isError).toBe(true)
  const structured = result.structuredContent as { error_code: string; message: string }
  expect(structured.error_code).toBe("UNAVAILABLE")
  expect(structured.message).toContain("Balatro is not in a run")
})

test("rejects invalid postgame URI with INVALID_URI error", async () => {
  const bridge = mockBridge()
  const result = await executeReadResource(bridge, ["postgame://not_an_index"])

  expect(result.isError).toBe(true)
  const structured = result.structuredContent as { error_code: string; message: string }
  expect(structured.error_code).toBe("INVALID_URI")
  expect(structured.message).toContain("Resource URI postgame://not_an_index is invalid")
})

test("handles bridge errors gracefully", async () => {
  const bridge = {
    getState: async () => {
      throw new BridgeError("GAME_NOT_RUNNING", "Balatro is not running")
    },
  } as unknown as BridgeClient

  const result = await executeReadResource(bridge, ["balatro://turn"])

  expect(result.isError).toBe(true)
  const structured = result.structuredContent as { error_code: string; message: string }
  expect(structured.error_code).toBe("GAME_NOT_RUNNING")
  expect(structured.message).toBe("Balatro is not running")
})
