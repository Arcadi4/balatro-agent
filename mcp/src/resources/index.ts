import type { McpServer } from "@modelcontextprotocol/server"

import type { BridgeClient } from "../bridge/socket-client.js"
import { registerResourceDefinition, type ResourceDefinition } from "./catalog.js"
import { type DiscoverInstances, liveResources, observeLiveInstances } from "./live.js"
import { postgameResources } from "./postgame.js"
import { referenceResources } from "./reference.js"
import { wikiResources } from "./wiki.js"

export { readResource } from "./catalog.js"

/**
 * Builds the complete resource catalog. Without an observer the live resources
 * read the registry on demand, so a standalone reader needs no MCP server.
 */
export function createResources(
  bridge: BridgeClient,
  discover: DiscoverInstances = () => bridge.listInstances(),
): ResourceDefinition[] {
  return [
    ...referenceResources,
    ...liveResources(bridge, discover),
    ...wikiResources,
    ...postgameResources,
  ]
}

/** Registers the catalog and opts into live discovery notifications for MCP. */
export function registerAllResources(server: McpServer, bridge: BridgeClient): void {
  const discover = observeLiveInstances(server, bridge)
  for (const definition of createResources(bridge, discover)) {
    registerResourceDefinition(server, definition)
  }
}
