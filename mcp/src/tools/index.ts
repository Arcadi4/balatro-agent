import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { Deps } from "../deps.js"
import { registerBlindTools } from "./blind.js"
import { registerBoosterTools } from "./booster.js"
import { registerBuyTools } from "./buy.js"
import { registerCardActionTools } from "./cardActions.js"
import { registerEntityTools } from "./entities.js"
import { registerHandTools } from "./hand.js"
import { registerInspectGameState } from "./inspectGameState.js"
import { registerPlayDiscardTools } from "./playDiscard.js"
import { registerReorderJokersTool } from "./reorderJokers.js"
import { registerRulesTool } from "./rules.js"
import { registerShopFlowTools } from "./shopFlow.js"

export function registerAllTools(server: McpServer, deps: Deps): void {
  registerRulesTool(server, deps)
  registerInspectGameState(server, deps)
  registerBlindTools(server, deps)
  registerHandTools(server, deps)
  registerPlayDiscardTools(server, deps)
  registerCardActionTools(server, deps)
  registerBuyTools(server, deps)
  registerShopFlowTools(server, deps)
  registerBoosterTools(server, deps)
  registerReorderJokersTool(server, deps)
  registerEntityTools(server, deps)
}
