import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import type { GameGate } from "../gate.js"
import { registerActionTools } from "./actions.js"
import { registerConnectTool } from "./connect.js"
import { registerEntityTools } from "./entities.js"
import { registerPostgameTools } from "./postgame.js"

export function registerAllTools(server: McpServer, bridge: BridgeClient, gate: GameGate): void {
  registerConnectTool(server, bridge, gate)
  registerActionTools(server, bridge, gate)
  // Wiki search and post-game analyses are file/network based and work
  // without a game connection, so they stay outside the gate.
  registerEntityTools(server)
  registerPostgameTools(server)
}
