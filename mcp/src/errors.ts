import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";

type ToolErrorStructuredContent = {
  error_code: string;
  message: string;
  [key: string]: unknown;
};

export type ToolErrorEnvelope = CallToolResult & {
  content: [TextContent];
  structuredContent: ToolErrorStructuredContent;
  isError: true;
};

export function toolError(
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
): ToolErrorEnvelope {
  const structuredContent = {
    error_code: errorCode,
    message,
    ...(details ?? {}),
  };

  const text = JSON.stringify(structuredContent, null, 2);

  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: true,
  };
}
