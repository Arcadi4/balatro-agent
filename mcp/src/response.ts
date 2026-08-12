import type { CallToolResult } from "@modelcontextprotocol/server"
import type { CallToolResult as LegacyCallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js"

import { BridgeError, type BridgeClient } from "./bridge/socket-client.js"
import { CHARACTER_LIMIT } from "./constants.js"

export interface TruncationContext {
  truncated?: boolean
  truncation_message?: string
  total?: number
  count?: number
  offset?: number
  has_more?: boolean
  next_offset?: number
}

export interface FormatResponseContext {
  truncation?: TruncationContext
  toMarkdown?: (data: object) => string
}

export type ToolResponseEnvelope = LegacyCallToolResult & {
  content: [TextContent]
  structuredContent: Record<string, unknown>
}

export type MarkdownFormatter = (data: Record<string, unknown>) => string

export interface CommandResultOptions {
  timeoutMs?: number
  toMarkdown?: MarkdownFormatter
}

function defaultMarkdown(data: Record<string, unknown>): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```"
}

function withTruncationFlag(
  structured: Record<string, unknown>,
  context?: TruncationContext,
): Record<string, unknown> {
  if (!context) return structured
  return {
    ...structured,
    ...Object.fromEntries(
      Object.entries(context).filter(([, value]) => value !== undefined),
    ),
  }
}

function enforceCharacterLimit(
  text: string,
  structured: Record<string, unknown>,
): { text: string; structured: Record<string, unknown> } {
  if (text.length <= CHARACTER_LIMIT) return { text, structured }
  const truncationMessage =
    `Response exceeded ${CHARACTER_LIMIT} characters and was truncated. ` +
    "Re-issue the call with a smaller `limit`, a more specific filter, or a non-zero `offset` to continue."
  return {
    text: text.slice(0, CHARACTER_LIMIT),
    structured: { ...structured, truncated: true, truncation_message: truncationMessage },
  }
}

export function formatResponse(
  data: Record<string, unknown>,
  context?: FormatResponseContext,
): ToolResponseEnvelope {
  const structured = withTruncationFlag(data, context?.truncation)
  const rendered = (context?.toMarkdown ?? defaultMarkdown)(structured)
  const enforced = enforceCharacterLimit(rendered, structured)
  return {
    content: [{ type: "text", text: enforced.text }],
    structuredContent: enforced.structured,
  }
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
