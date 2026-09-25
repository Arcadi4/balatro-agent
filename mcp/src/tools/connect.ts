import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { toolResult, withBridgeErrors } from "../response.js"
import CONNECT_DESCRIPTION from "./descriptions/connect.txt" with { type: "text" }

const STATE_TIMEOUT_MS = 1_500

const connectInputSchema = z
  .object({
    instance_id: z.string().min(1).optional().describe("Instance ID from balatro://instances."),
  })
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

function connectToMarkdown(data: Record<string, unknown>): string {
  return `Connected to Balatro instance ${String(data.instance_id)}; game phase: ${String(data.phase)}. Read balatro://instances/${String(data.instance_id)}/turn for the live snapshot.`
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
}
