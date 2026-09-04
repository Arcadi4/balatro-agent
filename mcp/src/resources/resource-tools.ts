import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError } from "@modelcontextprotocol/server"
import { z } from "zod"

import { BridgeError, type BridgeClient } from "../bridge/socket-client.js"
import { toolError, toolResult } from "../response.js"
import READ_RESOURCE_DESCRIPTION from "../tools/descriptions/read-resource.txt" with { type: "text" }
import { readResource } from "./catalog.js"
import { type CachedLiveState, readLiveResourceUri } from "./live.js"
import { POSTGAME_URI_SCHEME, postgameResources } from "../postgame.js"
import { referenceResources } from "./reference.js"
import { WIKI_INDEX_URI, wikiResources } from "./wiki.js"

export const RESOURCE_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations

const readResourceInputSchema = z
  .object({
    uris: z
      .array(z.string().min(1))
      .min(1)
      .describe("One or more balatro:// or postgame:// resource URIs to read."),
  })
  .strict()

const readResourceOutputSchema = z
  .object({
    results: z.array(
      z
        .object({
          uri: z.string(),
          markdown: z.string(),
        })
        .strict(),
    ),
  })
  .strict()

interface ResolvedResource {
  uri: string
  markdown: string
  cachedState?: CachedLiveState
}

const STATIC_RESOURCES = [...referenceResources, ...wikiResources, ...postgameResources]

async function readStaticResource(
  uri: string,
): Promise<{ uri: string; markdown: string } | undefined> {
  try {
    const result = await readResource(STATIC_RESOURCES, uri)
    const content = result.contents[0]
    if (content === undefined || !("text" in content)) return undefined
    return { uri: content.uri, markdown: content.text }
  } catch (error) {
    if (error instanceof ResourceNotFoundError) return undefined
    throw error
  }
}

async function resolveResourceUri(
  bridge: BridgeClient,
  rawUri: string,
  cachedState?: CachedLiveState,
): Promise<ResolvedResource> {
  const uri = rawUri.trim()

  if (uri.startsWith("postgame://")) {
    const result = await readStaticResource(uri)
    if (result) return result
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `Resource URI ${uri} is invalid: expected ${POSTGAME_URI_SCHEME} or ${POSTGAME_URI_SCHEME}<index>`,
    )
  }

  if (uri.startsWith("balatro://")) {
    const normalized = uri.replace(/\/+$/, "")
    const staticResult = await readStaticResource(
      normalized === "balatro://wiki" ? WIKI_INDEX_URI : normalized,
    )
    if (staticResult) return staticResult

    const liveResult = await readLiveResourceUri(bridge, normalized, cachedState)
    if (liveResult) {
      return {
        uri: liveResult.uri,
        markdown: liveResult.markdown,
        cachedState: { instanceId: liveResult.instanceId, payload: liveResult.state },
      }
    }

    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `Unknown Balatro resource URI "${uri}". Supported URIs include: balatro://turn, balatro://hand, balatro://jokers, balatro://consumables, balatro://deck, balatro://shop, balatro://booster, balatro://run, balatro://ante, balatro://decks, balatro://challenges, balatro://card_modifiers, balatro://wiki/<title>, and postgame://`,
    )
  }

  throw new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    `Unsupported URI scheme in "${uri}": only balatro:// and postgame:// URIs are supported.`,
  )
}

export async function executeReadResource(
  bridge: BridgeClient,
  uris: string[],
): Promise<CallToolResult> {
  let cachedState: CachedLiveState | undefined
  const results: Array<{ uri: string; markdown: string }> = []

  for (const uri of uris) {
    try {
      const resolved = await resolveResourceUri(bridge, uri, cachedState)
      if (resolved.cachedState !== undefined) {
        cachedState = resolved.cachedState
      }
      results.push({ uri: resolved.uri, markdown: resolved.markdown })
    } catch (error) {
      if (error instanceof BridgeError) {
        return toolError(error.code, error.message, { uri })
      }
      if (error instanceof ProtocolError) {
        const errorData =
          error.data && typeof error.data === "object"
            ? (error.data as Record<string, unknown>)
            : {}
        const errorCode =
          typeof errorData.error_code === "string"
            ? errorData.error_code
            : error.code === ProtocolErrorCode.InvalidParams
              ? "INVALID_URI"
              : "UNAVAILABLE"
        return toolError(errorCode, error.message, { uri, ...errorData })
      }
      if (error instanceof Error) {
        return toolError("INVALID_URI", error.message, { uri })
      }
      throw error
    }
  }

  return toolResult({ results }, (data) => {
    const items = (data.results as Array<{ uri: string; markdown: string }>) ?? []
    if (items.length === 1 && items[0]) {
      return items[0].markdown
    }
    return items.map((item) => item.markdown).join("\n\n---\n\n")
  })
}

export function registerResourceReadTool(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "balatro_read_resource",
    {
      title: "Read Balatro Resource",
      description: READ_RESOURCE_DESCRIPTION,
      inputSchema: readResourceInputSchema,
      outputSchema: readResourceOutputSchema,
      annotations: RESOURCE_TOOL_ANNOTATIONS,
    },
    ({ uris }) => executeReadResource(bridge, uris),
  )
}
