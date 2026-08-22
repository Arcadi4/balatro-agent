import type { McpServer } from "@modelcontextprotocol/server"
import { ProtocolError, ProtocolErrorCode, ResourceTemplate } from "@modelcontextprotocol/server"

import { listPostgames, POSTGAME_URI_SCHEME, readPostgame } from "../postgame.js"

const LIST_URI = POSTGAME_URI_SCHEME

function renderList(
  dir: string,
  entries: Array<{ index: number; title: string; summary: string }>,
): string {
  const header = [
    "# Post-Game Analyses",
    "",
    `All analyses are stored as markdown files under: ${dir}`,
    "",
  ]
  if (entries.length === 0) {
    return [
      ...header,
      "No post-game analyses stored yet. Create one with new_postgame(title, summary, content) after a run ends.",
      "",
    ].join("\n")
  }
  const rows = entries.map(
    (entry) =>
      `| ${entry.index} | ${entry.title.replaceAll("|", "\\|")} | ${entry.summary.replaceAll("|", "\\|")} |`,
  )
  return [
    ...header,
    "| Index | Title | Summary |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "Read an analysis with the " + `${POSTGAME_URI_SCHEME}<index>` + " resource.",
    "",
  ].join("\n")
}

export function registerPostgameResource(server: McpServer): void {
  server.registerResource(
    "postgame_index",
    LIST_URI,
    {
      title: "Post-Game Analyses",
      description:
        "List of all stored post-game run analyses with their index, title, and summary, plus the directory where they are stored.",
      mimeType: "text/markdown",
    },
    async () => {
      const { dir, entries } = await listPostgames()
      return {
        contents: [{ uri: LIST_URI, mimeType: "text/markdown", text: renderList(dir, entries) }],
      }
    },
  )

  server.registerResource(
    "postgame",
    new ResourceTemplate(`${POSTGAME_URI_SCHEME}{index}`, { list: undefined }),
    {
      title: "Post-Game Analysis",
      description:
        "A stored post-game analysis document. Browse indices at postgame://; create new analyses with the new_postgame tool after a run ends.",
      mimeType: "text/markdown",
    },
    async (uri: URL, variables: Record<string, string | string[]>) => {
      const indexValue = variables.index
      const raw = typeof indexValue === "string" ? indexValue : (indexValue?.[0] ?? "")
      const index = Number.parseInt(raw, 10)
      if (!Number.isInteger(index) || index < 1 || String(index) !== raw) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `Resource URI ${uri.toString()} is invalid: expected ${POSTGAME_URI_SCHEME}<index> with a positive integer index`,
        )
      }
      const text = await readPostgame(index)
      if (text === null) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `No post-game analysis exists at ${uri.toString()}; browse stored analyses at ${POSTGAME_URI_SCHEME}`,
        )
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: "text/markdown", text }],
      }
    },
  )
}
