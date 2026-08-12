import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { Deps } from "../deps.js"
import { registerRulesResource } from "./rules.js"

export function registerAllResources(server: McpServer, _deps: Deps): void {
  registerRulesResource(server)
  void _deps
}
