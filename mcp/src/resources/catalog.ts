import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
} from "@modelcontextprotocol/server"
import type {
  CacheHint,
  McpServer,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/server"

/**
 * One resource the server exposes, independent of the MCP server instance.
 *
 * `read` receives the parsed request URI plus the matched template variables
 * (empty for a static URI). The same definitions back both MCP registration
 * and the standalone CLI resource reader.
 */
export interface ResourceDefinition {
  name: string
  uri: string | ResourceTemplate
  metadata: Omit<Resource, "uri" | "name"> & { cacheHint?: CacheHint }
  read(
    uri: URL,
    variables: Record<string, string | string[]>,
  ): ReadResourceResult | Promise<ReadResourceResult>
}

/** Registers one definition with an MCP server, keeping its metadata and callback. */
export function registerResourceDefinition(
  server: McpServer,
  definition: ResourceDefinition,
): void {
  if (typeof definition.uri === "string") {
    server.registerResource(definition.name, definition.uri, definition.metadata, (uri) =>
      definition.read(uri, {}),
    )
    return
  }
  server.registerResource(definition.name, definition.uri, definition.metadata, (uri, variables) =>
    definition.read(uri, variables),
  )
}

/**
 * Reads a resource URI without an MCP server.
 *
 * Matching follows `resources/read`: parse the URI as WHATWG, prefer an exact
 * canonical static URI, then match templates in definition order. A URI that
 * parses as neither raises the same Invalid Params failure the SDK emits.
 */
export async function readResource(
  resources: readonly ResourceDefinition[],
  input: string,
): Promise<ReadResourceResult> {
  let uri: URL
  try {
    uri = new URL(input)
  } catch {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Resource URI ${input} is invalid`, {
      uri: input,
      reason: "invalid_uri",
    })
  }

  const canonical = uri.toString()
  for (const definition of resources) {
    if (typeof definition.uri === "string" && new URL(definition.uri).toString() === canonical) {
      return definition.read(uri, {})
    }
  }
  for (const definition of resources) {
    if (typeof definition.uri === "string") continue
    const variables = definition.uri.uriTemplate.match(canonical)
    if (variables) return definition.read(uri, variables)
  }
  throw new ResourceNotFoundError(input)
}
