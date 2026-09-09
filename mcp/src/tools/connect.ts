import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { toolResult, withBridgeErrors } from "../response.js"
import CONNECT_DESCRIPTION from "./descriptions/connect.txt" with { type: "text" }

const STATE_TIMEOUT_MS = 1_500

const connectInputSchema = z.object({}).strict()
const connectOutputSchema = z
  .object({
    ok: z.literal(true),
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
  return `Connected to the Balatro bridge; game phase: ${String(data.phase)}. Read balatro://turn for the live snapshot.`
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
    () =>
      withBridgeErrors(
        async () => {
          await bridge.connect()
          const payload = await bridge.getState(STATE_TIMEOUT_MS)
          return {
            phase: typeof payload.phase === "string" ? payload.phase : "UNKNOWN",
          }
        },
        ({ phase }) => toolResult({ ok: true, phase }, connectToMarkdown),
      ),
  )
}
