import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import type { BridgeClient } from "../bridge/socket-client.js"
import { asRecord, toolError, toolResult, withBridgeErrors } from "../response.js"
import { searchWiki } from "../wiki.js"
import LIST_DESCRIPTION from "./descriptions/list-entities.txt" with { type: "text" }
import WIKI_SEARCH_DESCRIPTION from "./descriptions/wiki-search.txt" with { type: "text" }

const gameIdSchema = z
  .string()
  .regex(
    /^(?:[jcvpmeb]_|bl_|tag_|stake_|seal_)[a-z0-9]+(?:_[a-z0-9]+)*$/,
    "Use an in-game entity key such as 'j_odd_todd', not a bare slug, display name, or type/slug alias.",
  )
  .describe(
    "In-game entity key, e.g. 'j_odd_todd', 'c_strength', 'v_overstock_norm', or 'tag_coupon'.",
  )

const listInputSchema = z
  .object({
    id: gameIdSchema
      .optional()
      .describe(
        "Optional in-game entity key for a single runtime entity, e.g. 'j_odd_todd' or 'c_strength'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe(
        "Maximum number of runtime entities to return per page. Min 1, max 100, default 20.",
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of runtime entities to skip for pagination. Default 0."),
  })
  .strict()
const listOutputSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())),
    total: z.number().int(),
    count: z.number().int(),
    offset: z.number().int(),
    has_more: z.boolean(),
    next_offset: z.number().int().optional(),
    source: z.string(),
  })
  .strict()

const wikiSearchInputSchema = z
  .object({
    query: z.string().min(1).describe("Search keyword or phrase."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Maximum number of results. Default 10."),
  })
  .strict()
const wikiSearchOutputSchema = z
  .object({
    results: z.array(
      z.object({
        title: z.string(),
        snippet: z.string(),
        url: z.string(),
      }),
    ),
  })
  .strict()

const LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations

const WIKI_ANNOTATIONS = {
  ...LOCAL_ANNOTATIONS,
  openWorldHint: true,
} as const satisfies ToolAnnotations

function listToMarkdown(data: object): string {
  const d = data as Record<string, unknown>
  const items = (d.items ?? []) as Array<Record<string, unknown>>
  const total = d.total ?? 0
  const source = String(d.source ?? "")
  const lines = [`# Runtime Entities (${String(total)})`, `Source: ${source}`, ""]
  for (const item of items) {
    const id = String(item.card_id ?? item.entity_id ?? item.id ?? "?")
    const name = String(item.name ?? "")
    lines.push(`- \`${id}\`${name ? ` — ${name}` : ""}`)
  }
  return lines.join("\n")
}

function wikiSearchToMarkdown(data: object): string {
  const d = data as Record<string, unknown>
  const results = (d.results ?? []) as Array<Record<string, unknown>>
  if (results.length === 0) return "No matching Balatro Wiki pages found."
  const lines = ["# Wiki Search Results", ""]
  for (const result of results) {
    const title = String(result.title ?? "")
    const url = String(result.url ?? "")
    const snippet = String(result.snippet ?? "")
    lines.push(`- [${title}](${url})`)
    if (snippet) lines.push(`  ${snippet}`)
  }
  return lines.join("\n")
}

async function listRuntimeEntities(bridge: BridgeClient, args: z.infer<typeof listInputSchema>) {
  return withBridgeErrors(
    () =>
      bridge.command(
        "list_game_entities",
        {
          id: args.id,
          limit: args.limit,
          offset: args.offset,
        },
        5_000,
      ),
    (data) => {
      const structured = asRecord(data)
      return structured
        ? toolResult(structured, listToMarkdown)
        : toolError("PROTOCOL_MISMATCH", "Runtime entity query returned invalid data")
    },
  )
}

async function searchWikiTool(args: z.infer<typeof wikiSearchInputSchema>) {
  try {
    const results = await searchWiki(args.query, args.limit)
    return toolResult({ results }, wikiSearchToMarkdown)
  } catch (err) {
    return toolError("WIKI_SEARCH_FAILED", err instanceof Error ? err.message : String(err))
  }
}

export function registerEntityTools(server: McpServer, bridge: BridgeClient): void {
  server.registerTool(
    "balatro_list_game_entities",
    {
      title: "List Game Entities",
      description: LIST_DESCRIPTION,
      inputSchema: listInputSchema,
      outputSchema: listOutputSchema,
      annotations: LOCAL_ANNOTATIONS,
    },
    (args) => listRuntimeEntities(bridge, args),
  )

  server.registerTool(
    "balatro_wiki_search",
    {
      title: "Search Balatro Wiki",
      description: WIKI_SEARCH_DESCRIPTION,
      inputSchema: wikiSearchInputSchema,
      outputSchema: wikiSearchOutputSchema,
      annotations: WIKI_ANNOTATIONS,
    },
    (args) => searchWikiTool(args),
  )
}
