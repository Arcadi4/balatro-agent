import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Deps } from "../deps.js";
import { formatResponse, type ResponseFormat } from "../response.js";
import { toolError } from "../errors.js";
import { BridgeError } from "../bridge/socket-client.js";

const WIKI_API_URL = "https://balatrowiki.org/api.php";

const LIST_DESCRIPTION =
  "Reads Balatro entity prototypes from the running game runtime, not the local wiki catalog. " +
  "Use this to inspect in-game descriptions, prototype config, and any live card instances matching an entity. " +
  "Pass id for one known runtime entity (e.g. 'j_odd_todd' or 'joker/odd_todd'), or type/name_contains with pagination for discovery.";

const GET_DESCRIPTION =
  "Fetches the actual Balatro Wiki page body for an entity and returns clean, compact, model-readable text. " +
  "Use content_scope='intro' for a concise effect summary, or content_scope='full' when you need strategy/synergy guidance from the rest of the article. " +
  "This reads balatrowiki.org through the MediaWiki API; use balatro_list_game_entities for game-runtime descriptions and dynamic fields. " +
  "Accepts raw game IDs like 'j_odd_todd', path aliases like 'joker/odd_todd', or display titles like 'Odd Todd'.";

const listInputSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe("Optional entity ID for a single runtime entity, e.g. 'j_odd_todd', 'joker/odd_todd', or 'c_strength'."),
    type: z
      .string()
      .optional()
      .describe("Optional runtime entity type filter, e.g. joker, tarot, planet, spectral, voucher, booster."),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of runtime entities to return per page. Min 1, max 100, default 20."),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe("Number of runtime entities to skip for pagination. Default 0."),
    name_contains: z
      .string()
      .optional()
      .describe("Case-insensitive display-name substring filter, e.g. 'joker', 'fortune', or 'trio'."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const getInputSchema = z
  .object({
    id: z
      .string()
      .describe("Entity ID, alias, or wiki page title, e.g. 'j_odd_todd', 'joker/odd_todd', 'Odd Todd', or 'Canio'."),
    content_scope: z
      .enum(["intro", "full"])
      .default("intro")
      .describe("Wiki body scope. 'intro' returns the concise page lead; 'full' includes strategy, synergies, trivia, and other article sections up to max_chars."),
    intro_only: z
      .boolean()
      .optional()
      .describe("Deprecated compatibility flag. Prefer content_scope='intro' or content_scope='full'. When provided, true maps to intro and false maps to full."),
    max_chars: z
      .number()
      .min(500)
      .max(20000)
      .default(8000)
      .describe("Maximum cleaned wiki text characters to return. Default 8000, max 20000."),
    response_format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe("Output format. Use 'json' for programmatic parsing, 'markdown' for human-readable summaries."),
  })
  .strict();

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function listToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const items = (d.items ?? []) as Array<Record<string, unknown>>;
  const lines: string[] = [];

  lines.push("# Runtime Game Entities\n");
  lines.push(`**Source:** ${d.source ?? "runtime"}`);
  lines.push(`**Total:** ${d.total} | **Showing:** ${d.count} | **Offset:** ${d.offset}`);
  if (d.has_more) lines.push(`**Next offset:** ${d.next_offset}`);
  lines.push("");

  if (items.length > 0) {
    lines.push("| ID | Type | Name | Cost | Live | Description |");
    lines.push("|---|---|---|---:|---:|---|");
  }

  for (const item of items) {
    const description = Array.isArray(item.description) ? item.description.join(" ") : "";
    const liveCount = Array.isArray(item.live_instances) ? item.live_instances.length : 0;
    lines.push(
      `| \`${item.id}\` | ${item.type ?? ""} | ${item.name ?? "?"} | ${item.cost ?? ""} | ${liveCount} | ${description} |`,
    );
  }

  return lines.join("\n");
}

function wikiToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`# ${d.title}\n`);
  lines.push(`**Source:** ${d.source_url}`);
  if (d.truncated) lines.push(`**Truncated:** ${d.truncation_message}`);
  lines.push("");
  lines.push(String(d.extract ?? ""));
  return lines.join("\n");
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function wikiTitleFromId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.includes(" ")) return trimmed;

  const normalized = trimmed.normalize("NFKC").replace(/\s+/g, "_").toLowerCase();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex !== -1) return titleCaseSlug(normalized.slice(slashIndex + 1));
  if (/^[a-z]+_/.test(normalized)) return titleCaseSlug(normalized.replace(/^[a-z]+_/, ""));
  return titleCaseSlug(normalized);
}

function cleanWikiText(text: string): string {
  let cleaned = text.replace(/<br\s*\/?\s*>/gi, "\n");

  for (let i = 0; i < 6; i++) {
    cleaned = cleaned.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const parts = body.split("|").map((part) => part.trim()).filter(Boolean);
      if (parts.length <= 1) return "";
      return parts[parts.length - 1];
    });
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
    .trim();
}

type WikiContentScope = "intro" | "full";

async function fetchWikiExtract(id: string, contentScope: WikiContentScope, maxChars: number): Promise<Record<string, unknown>> {
  const title = wikiTitleFromId(id);
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "plain",
    titles: title,
    format: "json",
    formatversion: "2",
    redirects: "1",
  });
  if (contentScope === "intro") params.set("exintro", "1");

  const response = await fetch(`${WIKI_API_URL}?${params.toString()}`, {
    headers: { "User-Agent": "balatro-mcp/0.0.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from Balatro Wiki`);

  const body = await response.json() as {
    query?: {
      pages?: Array<{ title?: string; missing?: boolean; extract?: string }>;
      redirects?: Array<{ from: string; to: string }>;
    };
  };
  const page = body.query?.pages?.[0];
  if (!page || page.missing || !page.extract) {
    throw new Error(`No Balatro Wiki page content found for "${title}"`);
  }

  const cleaned = cleanWikiText(page.extract);
  const truncated = cleaned.length > maxChars;
  const extract = truncated ? cleaned.slice(0, maxChars).trimEnd() : cleaned;
  return {
    id,
    requested_title: title,
    title: page.title ?? title,
    content_scope: contentScope,
    extract,
    source_url: `https://balatrowiki.org/w/${encodeURIComponent((page.title ?? title).replace(/ /g, "_"))}`,
    api_url: `${WIKI_API_URL}?${params.toString()}`,
    redirects: body.query?.redirects ?? [],
    truncated,
    max_chars: maxChars,
    truncation_message: truncated ? `Wiki extract exceeded ${maxChars} cleaned characters; raise max_chars or use content_scope='intro'.` : undefined,
  };
}

async function listRuntimeEntities(deps: Deps, args: z.infer<typeof listInputSchema>, format: ResponseFormat) {
  let seq: number;
  try {
    seq = await deps.bridgeClient.sendCommand({
      kind: "list_game_entities",
      args: {
        id: args.id,
        type: args.type,
        name_contains: args.name_contains,
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
      },
    });
  } catch (err) {
    if (err instanceof BridgeError) return { ...toolError(err.code, err.message) };
    throw err;
  }

  const response = await deps.bridgeClient.awaitResponse(seq, { timeoutMs: 5_000 });
  if (!response.ok) {
    return { ...toolError(response.error_code ?? "BRIDGE_ERROR", response.error_message ?? "Runtime entity query failed") };
  }

  const bridgePayload = (response.data ?? {}) as Record<string, unknown>;
  const structured = ((bridgePayload.data ?? bridgePayload) as Record<string, unknown>);
  const envelope = formatResponse(structured, format, {
    toMarkdown: listToMarkdown,
    truncation: {
      total: typeof structured.total === "number" ? structured.total : undefined,
      count: typeof structured.count === "number" ? structured.count : undefined,
      offset: typeof structured.offset === "number" ? structured.offset : undefined,
      has_more: typeof structured.has_more === "boolean" ? structured.has_more : undefined,
      next_offset: typeof structured.next_offset === "number" ? structured.next_offset : undefined,
    },
  });
  return { ...envelope };
}

async function readWiki(id: string, contentScope: WikiContentScope, maxChars: number, format: ResponseFormat) {
  try {
    const structured = await fetchWikiExtract(id, contentScope, maxChars);
    const envelope = formatResponse(structured, format, { toMarkdown: wikiToMarkdown });
    return { ...envelope };
  } catch (err) {
    return { ...toolError("WIKI_FETCH_FAILED", err instanceof Error ? err.message : String(err)) };
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
      const format: ResponseFormat = args.response_format ?? "markdown";
      return listRuntimeEntities(deps, args, format);
    },
  );

  server.registerTool(
    "balatro_read_entity_wiki",
    {
      description: GET_DESCRIPTION,
      inputSchema: getInputSchema,
      annotations: ANNOTATIONS,
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? "markdown";
      const contentScope: WikiContentScope = args.intro_only === true
        ? "intro"
        : args.intro_only === false
          ? "full"
          : args.content_scope ?? "intro";
      return readWiki(args.id, contentScope, args.max_chars ?? 8000, format);
    },
  );
}
