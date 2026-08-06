/**
 * protocol.ts — JSON-RPC 2.0 protocol specification for the Balatro MCP bridge.
 *
 * Shared wire format used by:
 * - T3: TypeScript socket client (socket-client.ts)
 * - T5: Lua JSON-RPC dispatcher (Lua side)
 *
 * ## NDJSON Framing
 *
 * - Each message is a single line terminated by `\n`
 * - Both sides split incoming data on `\n` and parse each complete line
 * - Incomplete lines (no trailing `\n` yet) are buffered until more data arrives
 *
 * ## Method Name Convention
 *
 * Each JSON-RPC method name equals the command `kind` string:
 *   "play_hand", "get_state", "select_blind", "skip_blind",
 *   "select_hand_cards", "sort_hand", "discard_hand",
 *   "use_consumable", "sell_card", "buy_card", "buy_and_use_card",
 *   "reroll_shop", "leave_shop", "cash_out",
 *   "open_booster", "select_booster_card", "skip_booster",
 *   "reorder_jokers"
 *
 * The 17 action kinds from actions.lua are the method names.
 */

import type {
  JSONRPCErrorResponse,
  JSONRPCRequest,
  JSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";

export type JsonRpcRequest = Omit<JSONRPCRequest, "id" | "params"> & {
  id: number;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | (Omit<JSONRPCResultResponse, "id" | "result"> & {
    id: number;
    result: unknown;
    error?: never;
  })
  | (Omit<JSONRPCErrorResponse, "id"> & {
    id: number;
    result?: never;
  });

export type JsonRpcError = JSONRPCErrorResponse["error"];

// Error Code Mapping
// Application-level string codes → JSON-RPC integer codes.
// JSON-RPC 2.0 reserves the -32000 to -32099 range for server errors.
//
// Mapping convention:
//   -32001..-32005 — Transport-level errors (from BridgeClient)
//   -32010..-32017 — Action-level errors (from Lua action handlers)
//   -32032         — Catch-all internal error (far enough from -32000 to
//                    reduce collision risk with future application codes)

export const ErrorCodeMap: Record<string, number> = Object.freeze({
  // Transport-level errors (from BridgeClient)
  GAME_NOT_RUNNING: -32001,
  INSTANCE_BUSY: -32002,
  PROTOCOL_MISMATCH: -32003,
  STATE_STALE: -32004,
  STATE_NOT_FOUND: -32005,

  // Action-level errors (from Lua action handlers)
  WRONG_PHASE: -32010,
  INVALID_TARGET: -32011,
  INSUFFICIENT_FUNDS: -32012,
  NO_SLOT: -32013,
  SLOTS_FULL: -32013,
  ETERNAL_BLOCKED: -32014,
  PACK_LIMIT_REACHED: -32015,
  BOSS_REROLL_LOCKED: -32016,
  VOUCHER_DEPENDENCY: -32017,

  // Catch-all
  INTERNAL_ERROR: -32032,
});

export const ReverseErrorMap: Record<number, string> = Object.freeze(
  Object.fromEntries(Object.entries(ErrorCodeMap).map(([key, value]) => [value, key])),
);

/**
 * Standard JSON-RPC 2.0 error codes (per spec §5.1).
 */
export const STANDARD_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
} as const;

/**
 * Create a JsonRpcError from a string error code.
 * Falls back to INTERNAL_ERROR if the code is not recognized.
 */
export function toJsonRpcError(errorCode: string, message: string, data?: unknown): JsonRpcError {
  const code = ErrorCodeMap[errorCode] ?? ErrorCodeMap.INTERNAL_ERROR;
  return { code, message, data };
}

/**
 * Look up the string code for a JSON-RPC integer error code.
 * Returns "UNKNOWN" if not found.
 */
export function errorCodeToString(code: number): string {
  if (code === STANDARD_ERRORS.PARSE_ERROR.code) return "PARSE_ERROR";
  if (code === STANDARD_ERRORS.INVALID_REQUEST.code) return "INVALID_REQUEST";
  if (code === STANDARD_ERRORS.METHOD_NOT_FOUND.code) return "UNKNOWN_METHOD";
  return ReverseErrorMap[code] ?? "UNKNOWN";
}

/**
 * Serialize a JSON-RPC request or response as a single NDJSON frame.
 * Appends `\n` as the message delimiter.
 */
export function serializeFrame(obj: JsonRpcRequest | JsonRpcResponse): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Parse a buffer of NDJSON data into completed messages and any trailing
 * incomplete data.
 *
 * - Splits the buffer on `\n`
 * - Attempts to JSON-parse each complete line
 * - Malformed lines are silently skipped (caller may log at debug level)
 * - Any data after the last `\n` is returned as `remainder` for buffering
 * - An empty buffer or buffer with no `\n` returns remainder as-is
 */
export function parseFrames(buffer: string): {
  messages: (JsonRpcRequest | JsonRpcResponse)[];
  remainder: string;
} {
  const messages: (JsonRpcRequest | JsonRpcResponse)[] = [];

  const lastNewline = buffer.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { messages, remainder: buffer };
  }

  const complete = buffer.slice(0, lastNewline);
  const remainder = buffer.slice(lastNewline + 1);

  for (const line of complete.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        messages.push(parsed as JsonRpcRequest | JsonRpcResponse);
      }
    } catch {
      // Malformed JSON — skip (caller may log at debug level)
    }
  }

  return { messages, remainder };
}

/**
 * Check if an unknown value is a structurally valid JSON-RPC 2.0 request.
 */
export function isJsonRpcRequest(obj: unknown): obj is JsonRpcRequest {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return r.jsonrpc === "2.0" && typeof r.id === "number" && typeof r.method === "string";
}

/**
 * Check if an unknown value is a structurally valid JSON-RPC 2.0 response.
 */
export function isJsonRpcResponse(obj: unknown): obj is JsonRpcResponse {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (r.jsonrpc !== "2.0" || typeof r.id !== "number") return false;
  // result and error are mutually exclusive per JSON-RPC 2.0 spec
  if (r.result !== undefined && r.error !== undefined) return false;
  return r.result !== undefined || r.error !== undefined;
}

/**
 * Default TCP port used by the Windows (Winsock) bridge backend.
 *
 * macOS/Linux use a Unix domain socket at /tmp/balatro-mcp.sock; Windows does
 * not support AF_UNIX, so the Lua mod listens on a TCP loopback socket instead.
 * The Lua side (mods/balatro_mcp/src/socket_server.lua) hard-codes the same
 * default. Keep these in sync.
 */
export const DEFAULT_BRIDGE_PORT = 37651;

/**
 * Loopback host used by the TCP bridge backend on Windows.
 */
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";
