import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { getRulesLastUpdated, getRulesVersion } from "../resources/rules.js";
import { formatResponse } from "../response.js";
import GET_GAME_RULES_DESCRIPTION from "./descriptions/get-game-rules.txt" with { type: "text" };

const inputSchema = z.object({}).strict();

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

function rulesToMarkdown(data: object): string {
  const d = data as Record<string, unknown>;
  return String(d.rules_prompt ?? "");
}

export function registerRulesTool(server: McpServer, deps: Deps): void {
  server.registerTool(
    "balatro_get_game_rules",
    {
      description: GET_GAME_RULES_DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const rules = await deps.rulesService.getGlobalRules();
      const structured: Record<string, unknown> = {
        rules_version: getRulesVersion(),
        rules_last_updated: getRulesLastUpdated(),
        source: rules.source ?? "bundled Balatro rules resource with wiki lookup guidance",
        required_first_step:
          "Before playing or resuming a Balatro run, call balatro_get_game_rules, then call balatro_inspect_game_state before any action.",
        rules_prompt: rules.markdown,
      };

      const envelope = formatResponse(structured, { toMarkdown: rulesToMarkdown });
      return { ...envelope };
    },
  );
}
