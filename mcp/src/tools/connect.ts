import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { toolResult, withBridgeErrors } from "../response.js"
import { INSTANCE_ID_DESCRIPTION } from "./actions.js"
import CONNECT_DESCRIPTION from "./descriptions/connect.txt" with { type: "text" }
import DISCONNECT_DESCRIPTION from "./descriptions/disconnect.txt" with { type: "text" }

const STATE_TIMEOUT_MS = 1_500

const connectInputSchema = z
  .object({ instance_id: z.string().min(1).optional().describe(INSTANCE_ID_DESCRIPTION) })
  .strict()
const connectOutputSchema = z
  .object({
    ok: z.literal(true),
    instance_id: z.string(),
    phase: z.string(),
  })
  .strict()

const CONNECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const disconnectInputSchema = z
  .object({ instance_id: z.string().min(1).optional().describe(INSTANCE_ID_DESCRIPTION) })
  .strict()
const disconnectOutputSchema = z
  .object({
    ok: z.literal(true),
    instance_id: z.string(),
  })
  .strict()
const DISCONNECT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

function disconnectToMarkdown(data: Record<string, unknown>): string {
  return `Disconnected from Balatro instance ${String(data.instance_id)}.`
}

function connectToMarkdown(data: Record<string, unknown>): string {
  return `Connected to Balatro instance ${String(data.instance_id)}; game phase: ${String(data.phase)}. Read balatro://turn for the selected instance's live snapshot.`
}

export function registerConnectTool(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "connect",
    {
      title: "Connect to Game",
      description: CONNECT_DESCRIPTION,
      inputSchema: connectInputSchema,
      outputSchema: connectOutputSchema,
      annotations: CONNECT_ANNOTATIONS,
    },
    ({ instance_id }) =>
      withBridgeErrors(
        async () => {
          const connected = await bridge.connect(instance_id)
          const payload = await bridge.getState(STATE_TIMEOUT_MS, connected.instance_id)
          return {
            instance_id: connected.instance_id,
            phase: typeof payload.phase === "string" ? payload.phase : "UNKNOWN",
          }
        },
        ({ instance_id, phase }) => toolResult({ ok: true, instance_id, phase }, connectToMarkdown),
      ),
  )

  server.registerTool(
    "disconnect",
    {
      title: "Disconnect from Game",
      description: DISCONNECT_DESCRIPTION,
      inputSchema: disconnectInputSchema,
      outputSchema: disconnectOutputSchema,
      annotations: DISCONNECT_ANNOTATIONS,
    },
    ({ instance_id }) =>
      withBridgeErrors(
        async () => {
          const disconnectedId = bridge.disconnect(instance_id)
          return { ok: true as const, instance_id: disconnectedId }
        },
        (data) => toolResult(data, disconnectToMarkdown),
      ),
  )
}
