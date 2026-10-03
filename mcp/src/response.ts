import type { CallToolResult } from "@modelcontextprotocol/server"
import { z } from "zod"

import { BridgeError, type BridgeClient } from "./bridge/socket-client.js"

export type MarkdownFormatter = (data: Record<string, unknown>) => string

export interface CommandResultOptions {
  instanceId?: string
  toMarkdown?: MarkdownFormatter
}

// Keep diagnostics nested so they cannot replace the error code or message.
export const toolErrorSchema = z
  .object({
    error_code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export function defaultMarkdown(data: Record<string, unknown>): string {
  return JSON.stringify(data)
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function toolResult(
  data: Record<string, unknown>,
  toMarkdown: MarkdownFormatter = defaultMarkdown,
): CallToolResult {
  return {
    content: [{ type: "text", text: toMarkdown(data) }],
    structuredContent: data,
  }
}

export function toolError(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
): CallToolResult {
  const structuredContent = {
    error_code: errorCode,
    message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  }
  return {
    content: [{ type: "text", text: `Error [${errorCode}]: ${message}` }],
    structuredContent,
    isError: true,
  }
}

export async function withBridgeErrors<T>(
  operation: () => Promise<T>,
  render: (value: T) => CallToolResult,
): Promise<CallToolResult> {
  try {
    return render(await operation())
  } catch (error) {
    if (error instanceof BridgeError) return toolError(error.code, error.message, error.details)
    throw error
  }
}

export async function commandResult(
  bridge: BridgeClient,
  kind: string,
  args?: Record<string, unknown>,
  options: CommandResultOptions = {},
): Promise<CallToolResult> {
  return withBridgeErrors(
    () => bridge.command(kind, args, options.instanceId),
    (data) => {
      const envelope: Record<string, unknown> = { ok: true }
      const record = asRecord(data)
      if (record && Object.keys(record).length > 0) {
        envelope.data = record
      }
      return toolResult(envelope, options.toMarkdown)
    },
  )
}
