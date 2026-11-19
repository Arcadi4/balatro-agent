import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { toolErrorSchema, toolResult, withBridgeErrors } from "../response.js"
import { instanceIndexInputSchema } from "./actions.js"
import CONNECT_DESCRIPTION from "./descriptions/connect.txt" with { type: "text" }
import DISCONNECT_DESCRIPTION from "./descriptions/disconnect.txt" with { type: "text" }

const STATE_TIMEOUT_MS = 1_500

const connectOutputSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      instance_index: z.number().int().min(0),
      phase: z.string(),
    })
    .strict(),
  toolErrorSchema,
])
const disconnectOutputSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      instance_index: z.number().int().min(0),
    })
    .strict(),
  toolErrorSchema,
])

const CONNECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const DISCONNECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

function disconnectToMarkdown(data: Record<string, unknown>): string {
  return `Disconnected from Balatro instance ${String(data.instance_index)}.`
}

function connectToMarkdown(data: Record<string, unknown>): string {
  const index = String(data.instance_index)
  return `Connected to Balatro instance ${index}; game phase: ${String(data.phase)}. Read balatro://instances/${index}/turn for its live snapshot.`
}

export async function connectGame(
  bridge: BridgeClient,
  { instance_index: instanceIndex }: z.output<typeof instanceIndexInputSchema>,
): Promise<CallToolResult> {
  return withBridgeErrors(
    async () => {
      const target = await bridge.resolveInstance(instanceIndex)
      await bridge.connect(target.instance)
      const payload = await bridge.getState(STATE_TIMEOUT_MS, target.instance.instance_id)
      return {
        instance_index: target.instance_index,
        phase: typeof payload.phase === "string" ? payload.phase : "UNKNOWN",
      }
    },
    ({ instance_index, phase }) =>
      toolResult({ ok: true, instance_index, phase }, connectToMarkdown),
  )
}

export async function disconnectGame(
  bridge: BridgeClient,
  { instance_index: instanceIndex }: z.output<typeof instanceIndexInputSchema>,
): Promise<CallToolResult> {
  return withBridgeErrors(
    async () => {
      const target = await bridge.resolveInstance(instanceIndex)
      bridge.disconnect(target.instance.instance_id)
      return { instance_index: target.instance_index }
    },
    ({ instance_index }) => toolResult({ ok: true as const, instance_index }, disconnectToMarkdown),
  )
}

export function registerConnectTool(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "connect",
    {
      title: "Connect to Game",
      description: CONNECT_DESCRIPTION,
      outputSchema: connectOutputSchema,
      inputSchema: instanceIndexInputSchema,
      annotations: CONNECT_ANNOTATIONS,
    },
    (args) => connectGame(bridge, args),
  )

  server.registerTool(
    "disconnect",
    {
      title: "Disconnect from Game",
      description: DISCONNECT_DESCRIPTION,
      inputSchema: instanceIndexInputSchema,
      outputSchema: disconnectOutputSchema,
      annotations: DISCONNECT_ANNOTATIONS,
    },
    (args) => disconnectGame(bridge, args),
  )
}
