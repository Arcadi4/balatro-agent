import { BridgeClient } from "./bridge/socket-client.js";
import { DEFAULT_BRIDGE_PORT } from "./bridge/protocol.js";
import type { Deps } from "./deps.js";
import { getRulesContent } from "./resources/rules.js";
import { runServer } from "./server.js";

/**
 * Read the bridge TCP port from the BALATRO_BRIDGE_PORT environment variable.
 * Falls back to the protocol default. Invalid values fall back silently.
 */
function readBridgePortFromEnv(): number {
  const raw = process.env.BALATRO_BRIDGE_PORT;
  if (raw === undefined || raw === "") return DEFAULT_BRIDGE_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(
      `[balatro-mcp-server] invalid BALATRO_BRIDGE_PORT "${raw}", using ${DEFAULT_BRIDGE_PORT}\n`,
    );
    return DEFAULT_BRIDGE_PORT;
  }
  return parsed;
}

async function main(): Promise<void> {
  const port = readBridgePortFromEnv();
  const bridgeClient = new BridgeClient({ port });

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
