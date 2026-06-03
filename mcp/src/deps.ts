import type { BridgeClient } from "./bridge/client.js";

export interface EntityCatalog {
  list(options?: { type?: string; name_contains?: string; limit?: number; offset?: number }): Promise<unknown>;
  get(canonicalId: string): Promise<unknown>;
}

export interface RulesService {
  getGlobalRules(): Promise<{ markdown: string; source_url?: string }>;
}

export interface Deps {
  bridgeClient: BridgeClient;
  entityCatalog: EntityCatalog;
  rulesService: RulesService;
}
