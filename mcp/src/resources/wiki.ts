import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from "@modelcontextprotocol/server"

import wikiIndexMarkdown from "../../data/wiki/index.md" with { type: "text" }
import { fetchWikiPage, type WikiPage } from "../wiki.js"
import type { ResourceDefinition } from "./catalog.js"

const WIKI_URI = "balatro://wiki"
const WIKI_INDEX_URI = `${WIKI_URI}/index`

export const wikiResources: readonly ResourceDefinition[] = [
  {
    name: "wiki_index",
    uri: WIKI_INDEX_URI,
    metadata: {
      title: "Balatro Wiki Index",
      description:
        "Index of important Balatro Wiki pages with their resource URI and content summary.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
    },
    read: () => ({
      contents: [{ uri: WIKI_INDEX_URI, mimeType: "text/markdown", text: wikiIndexMarkdown }],
    }),
  },
  {
    name: "wiki",
    uri: new ResourceTemplate(`${WIKI_URI}/{title}`, { list: undefined }),
    metadata: {
      title: "Balatro Wiki",
      description:
        "Balatro Wiki article fetched live and rendered as Markdown. See balatro://wiki/index for a page list, or use balatro_wiki_search to find a title.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
    },
    read: async (uri: URL, variables: Record<string, string | string[]>) => {
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
]

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
