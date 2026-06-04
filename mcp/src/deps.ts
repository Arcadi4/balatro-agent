import type { BridgeClient } from "./bridge/socket-client.js";

export interface RulesService {
  getGlobalRules(): Promise<{ markdown: string; source_url?: string }>;
}

export interface Deps {
  bridgeClient: BridgeClient;
  rulesService: RulesService;
}
