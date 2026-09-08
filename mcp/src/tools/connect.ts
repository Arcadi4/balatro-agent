import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import type { GameGate } from "../gate.js"
import { toolResult, withBridgeErrors } from "../response.js"
import CONNECT_DESCRIPTION from "./descriptions/connect.txt" with { type: "text" }

const STATE_TIMEOUT_MS = 1_500

const connectInputSchema = z.object({}).strict()
const connectOutputSchema = z
  .object({
    ok: z.literal(true),
    protocol_version: z.number().int(),
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

export function registerConnectTool(server: McpServer, bridge: BridgeClient, gate: GameGate): void {
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
          const info = await bridge.connect()
          gate.enable()
          const payload = await bridge.getState(STATE_TIMEOUT_MS)
          return {
            protocol_version: info.protocol_version,
            phase: typeof payload.phase === "string" ? payload.phase : "UNKNOWN",
          }
        },
        ({ protocol_version, phase }) =>
          toolResult({ ok: true, protocol_version, phase }, connectToMarkdown),
      ),
  )
}
