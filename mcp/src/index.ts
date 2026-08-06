import { BridgeClient } from "./bridge/socket-client.js";
import type { Deps } from "./deps.js";
import { getRulesContent } from "./resources/rules.js";
import { runServer } from "./server.js";

async function main(): Promise<void> {
  const bridgeClient = new BridgeClient();

  // Kick off the bridge connection in the background. If Balatro is not yet
  // running, connect() rejects and the client keeps retrying in the background
  // (see BridgeClient.scheduleReconnect). We must NOT exit here — the MCP
  // server should stay up so a later-started Balatro is picked up automatically.
  bridgeClient.connect().catch((err: unknown) => {
    process.stderr.write(
      `[balatro-mcp-server] bridge not connected yet: ${(err as Error).message}\n`,
    );
  });

  const deps: Deps = {
    bridgeClient,
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
