import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { registerActionTools } from "./actions.js"
import { registerEntityTools } from "./entities.js"
import { registerPostgameTools } from "./postgame.js"

export function registerAllTools(server: McpServer, bridge: BridgeClient): void {
  registerActionTools(server, bridge)
  registerEntityTools(server)
  registerPostgameTools(server)
}
