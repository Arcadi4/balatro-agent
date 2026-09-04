import type { McpServer } from "@modelcontextprotocol/server"
import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server"

import wikiIndexMarkdown from "../../data/wiki/index.md" with { type: "text" }
import { fetchWikiPage, type WikiPage } from "../wiki.js"

export const WIKI_URI = "balatro://wiki"
export const WIKI_INDEX_URI = `${WIKI_URI}/index`
export { wikiIndexMarkdown }

async function readWiki(title: string): Promise<{ uri: string; markdown: string }> {
  const normalized = title.trim()
  if (normalized === "") throw new Error("WIKI_MISSING_TITLE")
  const page = await fetchWikiPage(normalized)
  const uri = `${WIKI_URI}/${encodeURIComponent(normalized).replaceAll("%20", "_")}`
  return { uri, markdown: `# ${page.title}\n\n> Source: ${page.url}\n\n${page.markdown}` }
}

export async function readWikiResource(uri: string): Promise<{ uri: string; markdown: string }> {
  const prefix = `${WIKI_URI}/`
  if (!uri.startsWith(prefix)) throw new Error(`WIKI_UNKNOWN_URI: ${uri}`)
  const title = safeDecode(uri.slice(prefix.length)).replace(/_/g, " ").trim()
  if (title === "") {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `Wiki article title cannot be empty in "${uri}": use balatro://wiki/<Title>`,
    )
  }
  return readWiki(title)
}

export function registerWikiResource(server: McpServer): void {
  server.registerResource(
    "wiki_index",
    WIKI_INDEX_URI,
    {
      title: "Balatro Wiki Index",
      description:
        "Index of important Balatro Wiki pages with their resource URI and content summary.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
    },
    () => ({
      contents: [{ uri: WIKI_INDEX_URI, mimeType: "text/markdown", text: wikiIndexMarkdown }],
    }),
  )

  server.registerResource(
    "wiki",
    new ResourceTemplate(`${WIKI_URI}/{title}`, { list: undefined }),
    {
      title: "Balatro Wiki",
      description:
        "Balatro Wiki article fetched live and rendered as Markdown. See balatro://wiki/index for a page list, or use balatro_wiki_search to find a title.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
    },
    async (uri: URL, variables: Record<string, string | string[]>) => {
      const uriString = uri.toString()
      const titleValue = variables.title
      const rawTitle = typeof titleValue === "string" ? titleValue : (titleValue?.[0] ?? "")
      const title = safeDecode(rawTitle).replace(/_/g, " ").trim()
      if (title === "") {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `Wiki article title cannot be empty in "${uriString}": use balatro://wiki/<Title>`,
        )
      }
      // Only a page the wiki itself reports as absent becomes a read miss;
      // HTTP, network, and rendering failures stay distinct internal errors.
      let page: WikiPage
      try {
        page = await fetchWikiPage(title)
      } catch (error) {
        if (error instanceof Error && error.message === "WIKI_PAGE_NOT_FOUND") {
          throw new ResourceNotFoundError(
            uriString,
            `No Balatro Wiki article for "${title}" at ${uriString}; use balatro_wiki_search to find a title.`,
          )
        }
        throw error
      }
      return {
        contents: [
          {
            uri: uriString,
            mimeType: "text/markdown",
            text: `# ${page.title}\n\n> Source: ${page.url}\n\n${page.markdown}`,
          },
        ],
      }
    },
    },
  )
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
