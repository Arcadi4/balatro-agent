import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import type { Deps } from "../deps.js"
import { toolError } from "../errors.js"
import { formatResponse } from "../response.js"
import LIST_DESCRIPTION from "./descriptions/list-entities.txt" with { type: "text" }
import WIKI_DESCRIPTION from "./descriptions/read-wiki.txt" with { type: "text" }

const WIKI_API_URL = "https://balatrowiki.org/api.php"

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
      .min(1)
      .max(100)
      .default(20)
      .describe(
        "Maximum number of runtime entities to return per page. Min 1, max 100, default 20.",
      ),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of runtime entities to skip for pagination. Default 0."),
  })
  .strict()

const wikiInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(120)
      .describe(
        "Exact Balatro Wiki article title, e.g. 'Blueprint', 'The Hook', 'Booster Packs', 'Poker hands', or 'The Shop'. Do not pass entity IDs like 'j_blueprint'.",
      ),
    content_scope: z
      .enum(["intro", "full"])
      .default("intro")
      .describe(
        "Wiki body scope. 'intro' returns the concise page lead; 'full' includes strategy, synergies, trivia, and other article sections up to max_chars.",
      ),
    max_chars: z
      .number()
      .min(500)
      .max(20000)
      .default(8000)
      .describe("Maximum cleaned wiki text characters to return. Default 8000, max 20000."),
  })
  .strict()

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations

function listToMarkdown(data: object): string {
  const d = data as Record<string, unknown>
  const items = (d.items ?? []) as Array<Record<string, unknown>>
  const lines: string[] = []

  lines.push("# Runtime Game Entities\n")
  lines.push(`**Source:** ${d.source ?? "runtime"}`)
  lines.push(`**Total:** ${d.total} | **Showing:** ${d.count} | **Offset:** ${d.offset}`)
  if (d.has_more) lines.push(`**Next offset:** ${d.next_offset}`)
  lines.push("")

  if (items.length > 0) {
    lines.push("| ID | Type | Name | Cost | Live | Description |")
    lines.push("|---|---|---|---:|---:|---|")
  }

  for (const item of items) {
    const description = Array.isArray(item.description) ? item.description.join(" ") : ""
    const liveCount = Array.isArray(item.live_instances) ? item.live_instances.length : 0
    lines.push(
      `| \`${item.id}\` | ${item.type ?? ""} | ${item.name ?? "?"} | ${item.cost ?? ""} | ${liveCount} | ${description} |`,
    )
  }

  return lines.join("\n")
}

function wikiToMarkdown(data: object): string {
  const d = data as Record<string, unknown>
  const lines: string[] = []
  lines.push(`# ${d.title}\n`)
  lines.push(`**Source:** ${d.source_url}`)
  if (d.truncated) lines.push(`**Truncated:** ${d.truncation_message}`)
  lines.push("")
  lines.push(String(d.extract ?? ""))
  return lines.join("\n")
}

function cleanWikiText(text: string): string {
  let cleaned = text.replace(/<br\s*\/?\s*>/gi, "\n")

  for (let i = 0; i < 6; i++) {
    cleaned = cleaned.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const parts = body
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean)
      if (parts.length <= 1) return ""
      return parts[parts.length - 1] ?? ""
    })
  }

  return cleaned
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/[^\s\]]+\]/g, "")
    .replace(/'{2,}/g, "")
    .replace(/\s+\.png\b/gi, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

type WikiContentScope = "intro" | "full"

function normalizeWikiTitle(title: string): string {
  return title.trim().normalize("NFKC").replace(/\s+/g, " ")
}

async function fetchWikiExtract(
  title: string,
  contentScope: WikiContentScope,
  maxChars: number,
): Promise<Record<string, unknown>> {
  const normalizedTitle = normalizeWikiTitle(title)
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "plain",
    titles: normalizedTitle,
    format: "json",
    formatversion: "2",
    redirects: "1",
  })
  if (contentScope === "intro") params.set("exintro", "1")

  const response = await fetch(`${WIKI_API_URL}?${params.toString()}`, {
    headers: { "User-Agent": "balatro-mcp/0.0.0" },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} from Balatro Wiki`)

  const body = (await response.json()) as {
    query?: {
      pages?: Array<{ title?: string; missing?: boolean; extract?: string }>
      redirects?: Array<{ from: string; to: string }>
    }
  }
  const page = body.query?.pages?.[0]
  if (!page || page.missing || !page.extract) {
    throw new Error(
      `No Balatro Wiki page content found for "${normalizedTitle}". Pass an exact article title such as "Blueprint", "The Hook", "Booster Packs", or "Poker hands". If starting from an entity ID, call balatro_list_game_entities and use the returned name field.`,
    )
  }

  const cleaned = cleanWikiText(page.extract)
  const truncated = cleaned.length > maxChars
  const extract = truncated ? cleaned.slice(0, maxChars).trimEnd() : cleaned
  return {
    requested_title: normalizedTitle,
    title: page.title ?? title,
    content_scope: contentScope,
    extract,
    source_url: `https://balatrowiki.org/w/${encodeURIComponent((page.title ?? title).replace(/ /g, "_"))}`,
    api_url: `${WIKI_API_URL}?${params.toString()}`,
    redirects: body.query?.redirects ?? [],
    truncated,
    max_chars: maxChars,
    truncation_message: truncated
      ? `Wiki extract exceeded ${maxChars} cleaned characters; raise max_chars or use content_scope='intro'.`
      : undefined,
  }
}

async function listRuntimeEntities(deps: Deps, args: z.infer<typeof listInputSchema>) {
  let seq: number
  try {
    seq = await deps.bridgeClient.sendCommand({
      kind: "list_game_entities",
      args: {
        id: args.id,
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
      },
    })
  } catch (err) {
    if (err instanceof BridgeError) return { ...toolError(err.code, err.message) }
    throw err
  }

  const response = await deps.bridgeClient.awaitResponse(seq, { timeoutMs: 5_000 })
  if (!response.ok) {
    return {
      ...toolError(
        response.error_code ?? "BRIDGE_ERROR",
        response.error_message ?? "Runtime entity query failed",
      ),
    }
  }

  const structured = (response.data ?? {}) as Record<string, unknown>
  const envelope = formatResponse(structured, {
    toMarkdown: listToMarkdown,
    truncation: {
      total: typeof structured.total === "number" ? structured.total : undefined,
      count: typeof structured.count === "number" ? structured.count : undefined,
      offset: typeof structured.offset === "number" ? structured.offset : undefined,
      has_more: typeof structured.has_more === "boolean" ? structured.has_more : undefined,
      next_offset: typeof structured.next_offset === "number" ? structured.next_offset : undefined,
    },
  })
  return { ...envelope }
}

async function readWiki(title: string, contentScope: WikiContentScope, maxChars: number) {
  try {
    const structured = await fetchWikiExtract(title, contentScope, maxChars)
    const envelope = formatResponse(structured, { toMarkdown: wikiToMarkdown })
    return { ...envelope }
  } catch (err) {
    return { ...toolError("WIKI_FETCH_FAILED", err instanceof Error ? err.message : String(err)) }
  }
}

export function registerEntityTools(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_list_game_entities",
    {
      description: LIST_DESCRIPTION,
      inputSchema: listInputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const parsed = listInputSchema.safeParse(args)
      if (!parsed.success) return { ...toolError("INVALID_INPUT", z.prettifyError(parsed.error)) }

      return listRuntimeEntities(deps, parsed.data)
    },
  )

  server.registerTool(
    "balatro_read_wiki",
    {
      description: WIKI_DESCRIPTION,
      inputSchema: wikiInputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const parsed = wikiInputSchema.safeParse(args)
      if (!parsed.success) return { ...toolError("INVALID_INPUT", z.prettifyError(parsed.error)) }

      const contentScope: WikiContentScope = parsed.data.content_scope ?? "intro"
      return readWiki(parsed.data.title, contentScope, parsed.data.max_chars ?? 8000)
    },
  )
}
