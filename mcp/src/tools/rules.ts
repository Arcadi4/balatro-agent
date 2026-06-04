import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { Deps } from "../deps.js";
import { getRulesLastUpdated, getRulesVersion } from "../resources/rules.js";
import { formatResponse } from "../response.js";

const DESCRIPTION =
  "Retrieves the compact Balatro game rules prompt. Call this before starting or resuming gameplay because model memory may be stale on edge cases like debuffed cards, secret poker hands, stakes, and shop rules. " +
  "This is read-only and does not require a running Balatro instance.";

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
      description: DESCRIPTION,
      inputSchema,
      annotations: ANNOTATIONS,
    },
    async () => {
      const rules = await deps.rulesService.getGlobalRules();
      const structured: Record<string, unknown> = {
        rules_version: getRulesVersion(),
        rules_last_updated: getRulesLastUpdated(),
        source_url: rules.source_url ?? "https://balatrowiki.org",
        required_first_step:
          "Before playing or resuming a Balatro run, call balatro_get_game_rules, then call balatro_inspect_game_state before any action.",
        rules_prompt: rules.markdown,
      };

      const envelope = formatResponse(structured, { toMarkdown: rulesToMarkdown });
      return { ...envelope };
    },
  );
}
