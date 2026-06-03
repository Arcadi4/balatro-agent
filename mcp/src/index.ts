import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "./bridge/client.js";
import type { Deps } from "./deps.js";
import { EntityCatalog } from "./entities/catalog.js";
import { getRulesContent } from "./resources/rules.js";
import { runServer } from "./server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ENTITIES_DATA_DIR = resolve(__dirname, "../data/entities");

async function main(): Promise<void> {
  const bridgeClient = new BridgeClient();
  await bridgeClient.connect();

  const entityCatalog = new EntityCatalog(ENTITIES_DATA_DIR);

  const deps: Deps = {
    bridgeClient,
    entityCatalog: {
      async list(options) {
        return entityCatalog.listEntities(options);
      },
      async get(canonicalId) {
        return entityCatalog.getEntity(canonicalId);
      },
    },
    rulesService: {
      async getGlobalRules() {
        return { markdown: getRulesContent() };
      },
    },
  };

  await runServer({
    deps,
    flushBridge: async () => {
      await bridgeClient.dispose();
    },
  });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[balatro-mcp-server] fatal: ${(err as Error).message}\n${(err as Error).stack ?? ""}\n`,
  );
  process.exit(1);
});
