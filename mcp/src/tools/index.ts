import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { registerActionTools } from "./actions.js"
import { registerConnectTool } from "./connect.js"
import { registerEntityTools } from "./entities.js"
import { registerPostgameTools } from "./postgame.js"

export function registerAllTools(server: McpServer, bridge: BridgeClient): void {
  registerConnectTool(server, bridge)
  registerActionTools(server, bridge)
  registerEntityTools(server)
  registerPostgameTools(server)
}
