import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import { toolError, toolResult } from "../response.js"
import { searchWiki } from "../wiki.js"
import WIKI_SEARCH_DESCRIPTION from "./descriptions/wiki-search.txt" with { type: "text" }

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

const WIKI_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations

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

async function searchWikiTool(args: z.infer<typeof wikiSearchInputSchema>) {
  try {
    const results = await searchWiki(args.query, args.limit)
    return toolResult({ results }, wikiSearchToMarkdown)
  } catch (err) {
    return toolError("WIKI_SEARCH_FAILED", err instanceof Error ? err.message : String(err))
  }
}

export function registerEntityTools(server: McpServer): void {
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
