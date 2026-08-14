import type { McpServer } from "@modelcontextprotocol/server"
import { ResourceTemplate } from "@modelcontextprotocol/server"

import wikiIndexMarkdown from "../../data/wiki/index.md" with { type: "text" }
import { fetchWikiPage } from "../wiki.js"

const WIKI_URI = "balatro://wiki"
const WIKI_INDEX_URI = `${WIKI_URI}/index`

export function registerWikiResource(server: McpServer): void {
  server.registerResource(
    "wiki_index",
    WIKI_INDEX_URI,
    {
      title: "Balatro Wiki Index",
      description:
        "Index of important Balatro Wiki pages with their resource URI, URL, and content summary.",
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
      const title = safeDecode(rawTitle).replace(/_/g, " ")
      if (title === "") throw new Error("WIKI_MISSING_TITLE")
      const page = await fetchWikiPage(title)
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
  )
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
