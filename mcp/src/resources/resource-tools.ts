import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server"
import { z } from "zod"

import { BridgeError, type BridgeClient } from "../bridge/socket-client.js"
import { toolError, toolResult } from "../response.js"
import READ_RESOURCE_DESCRIPTION from "../tools/descriptions/read-resource.txt" with { type: "text" }
import { readCardModifiersResource } from "./cardModifiers.js"
import { readChallengesResource } from "./challenges.js"
import { readDecksResource } from "./decks.js"
import { readLiveResourceUri } from "./live.js"
import { readPostgameResource } from "./postgame.js"
import { readWikiResource, wikiIndexMarkdown } from "./wiki.js"

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
  state?: Record<string, unknown>
}

async function resolveResourceUri(
  bridge: BridgeClient,
  rawUri: string,
  cachedState?: Record<string, unknown>,
): Promise<ResolvedResource> {
  const uri = rawUri.trim()

  if (uri.startsWith("postgame://")) {
    const result = await readPostgameResource(uri)
    return { uri: result.uri, markdown: result.markdown }
  }

  if (uri.startsWith("balatro://")) {
    const normalized = uri.replace(/\/+$/, "")

    if (normalized === "balatro://decks") {
      const result = readDecksResource()
      return { uri: result.uri, markdown: result.markdown }
    }

    if (normalized === "balatro://challenges") {
      const result = readChallengesResource()
      return { uri: result.uri, markdown: result.markdown }
    }

    if (
      normalized === "balatro://card_modifiers" ||
      normalized.startsWith("balatro://card_modifiers/")
    ) {
      const subpath =
        normalized === "balatro://card_modifiers"
          ? ""
          : normalized.slice("balatro://card_modifiers/".length)
      const result = readCardModifiersResource(subpath)
      if (!result) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `Unknown card modifiers subresource: "${uri}". Valid options: balatro://card_modifiers, balatro://card_modifiers/enhancements, balatro://card_modifiers/seals, balatro://card_modifiers/editions, balatro://card_modifiers/stickers`,
        )
      }
      return { uri: result.uri, markdown: result.markdown }
    }

    if (normalized === "balatro://wiki" || normalized === "balatro://wiki/index") {
      return { uri: "balatro://wiki/index", markdown: wikiIndexMarkdown }
    }

    if (normalized.startsWith("balatro://wiki/")) {
      const result = await readWikiResource(normalized)
      return { uri: result.uri, markdown: result.markdown }
    }

    const liveResult = await readLiveResourceUri(bridge, normalized, cachedState)
    if (liveResult) {
      return liveResult
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
  let cachedState: Record<string, unknown> | undefined
  const results: Array<{ uri: string; markdown: string }> = []

  for (const uri of uris) {
    try {
      const resolved = await resolveResourceUri(bridge, uri, cachedState)
      if (resolved.state) {
        cachedState = resolved.state
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
