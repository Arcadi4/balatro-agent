import { CHARACTER_LIMIT } from "./constants.js";

import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

export interface TruncationContext {
  truncated?: boolean;
  truncation_message?: string;
  total?: number;
  count?: number;
  offset?: number;
  has_more?: boolean;
  next_offset?: number;
}

export interface FormatResponseContext {
  truncation?: TruncationContext;
  toMarkdown?: (data: object) => string;
}

export type ToolResponseEnvelope = CallToolResult & {
  content: [TextContent];
  structuredContent: Record<string, unknown>;
};

function defaultMarkdown(data: object): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

function withTruncationFlag(
  structured: Record<string, unknown>,
  ctx?: TruncationContext,
): Record<string, unknown> {
  if (!ctx) return structured;
  const merged: Record<string, unknown> = { ...structured };
  if (ctx.truncated !== undefined) merged.truncated = ctx.truncated;
  if (ctx.truncation_message !== undefined) merged.truncation_message = ctx.truncation_message;
  if (ctx.total !== undefined) merged.total = ctx.total;
  if (ctx.count !== undefined) merged.count = ctx.count;
  if (ctx.offset !== undefined) merged.offset = ctx.offset;
  if (ctx.has_more !== undefined) merged.has_more = ctx.has_more;
  if (ctx.next_offset !== undefined) merged.next_offset = ctx.next_offset;
  return merged;
}

function enforceCharacterLimit(
  text: string,
  structured: Record<string, unknown>,
): {
  text: string;
  structured: Record<string, unknown>;
} {
  if (text.length <= CHARACTER_LIMIT) {
    return { text, structured };
  }

  const truncationMessage =
    `Response exceeded ${CHARACTER_LIMIT} characters and was truncated. ` +
    `Re-issue the call with a smaller \`limit\`, a more specific filter, or a non-zero \`offset\` to continue.`;

  const truncatedText = text.slice(0, CHARACTER_LIMIT);

  const truncatedStructured: Record<string, unknown> = {
    ...structured,
    truncated: true,
    truncation_message: truncationMessage,
  };

  return { text: truncatedText, structured: truncatedStructured };
}

export function formatResponse(
  data: Record<string, unknown>,
  context?: FormatResponseContext,
): ToolResponseEnvelope {
  const structured = withTruncationFlag(data, context?.truncation);
  const text = (context?.toMarkdown ?? defaultMarkdown)(structured);

  const enforced = enforceCharacterLimit(text, structured);

  return {
    content: [{ type: "text", text: enforced.text }],
    structuredContent: enforced.structured,
  };
}
