import type { CallToolResult } from "@modelcontextprotocol/server"

import { BridgeError, type BridgeClient } from "./bridge/socket-client.js"

export type MarkdownFormatter = (data: Record<string, unknown>) => string

export interface CommandResultOptions {
  timeoutMs?: number
  toMarkdown?: MarkdownFormatter
}

function defaultMarkdown(data: Record<string, unknown>): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```"
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
  const structuredContent = { error_code: errorCode, message, ...details }
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
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
    if (error instanceof BridgeError) return toolError(error.code, error.message)
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
    () => bridge.command(kind, args, options.timeoutMs),
    (data) => toolResult({ ok: true, data: data ?? {} }, options.toMarkdown),
  )
}
