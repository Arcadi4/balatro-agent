import type { McpServer, ToolAnnotations } from "@modelcontextprotocol/server"
import { z } from "zod"

import { createPostgame } from "../postgame.js"
import { toolError, toolResult } from "../response.js"
import NEW_POSTGAME_DESCRIPTION from "./descriptions/new-postgame.txt" with { type: "text" }

const newPostgameInputSchema = z
  .object({
    title: z.string().min(1).describe("Short title naming the run, its strategy, and its outcome."),
    summary: z
      .string()
      .min(1)
      .describe(
        "1-2 sentences describing the run's strategy and when this experience would be valuable.",
      ),
    content: z
      .string()
      .min(1)
      .describe(
        "Markdown body of the analysis: what worked, decisive decisions, costly mistakes, and lessons that transfer to future runs.",
      ),
  })
  .strict()

const newPostgameOutputSchema = z
  .object({
    index: z.number().int().min(1),
    uri: z.string(),
    filepath: z.string(),
  })
  .strict()

const NEW_POSTGAME_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies ToolAnnotations

function newPostgameToMarkdown(data: Record<string, unknown>): string {
  return [
    `Created post-game analysis ${String(data.index)}.`,
    `Read it back at ${String(data.uri)}.`,
    `Stored at ${String(data.filepath)}.`,
  ].join("\n")
}

export function registerPostgameTools(server: McpServer): void {
  server.registerTool(
    "new_postgame",
    {
      title: "New Post-Game Analysis",
      description: NEW_POSTGAME_DESCRIPTION,
      inputSchema: newPostgameInputSchema,
      outputSchema: newPostgameOutputSchema,
      annotations: NEW_POSTGAME_ANNOTATIONS,
    },
    async (args) => {
      try {
        const ref = await createPostgame(args)
        return toolResult({ ...ref }, newPostgameToMarkdown)
      } catch (error) {
        return toolError(
          "POSTGAME_WRITE_FAILED",
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  )
}
