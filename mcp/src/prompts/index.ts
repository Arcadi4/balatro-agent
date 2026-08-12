import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { Deps } from "../deps.js"
import { registerStrategyPrompt } from "./strategy.js"

export function registerAllPrompts(server: McpServer, _deps: Deps): void {
  registerStrategyPrompt(server)
  void _deps
}
