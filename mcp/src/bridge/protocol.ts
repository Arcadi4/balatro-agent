export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

export const DEFAULT_BRIDGE_SOCKET_POSIX = "/tmp/balatro-mcp.sock"
export const DEFAULT_BRIDGE_SOCKET_WIN32 = "\\\\.\\pipe\\balatro-mcp"
export const BRIDGE_SOCKET_ENV_VAR = "BALATRO_BRIDGE_SOCKET"

export function resolveBridgeSocketPath(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[BRIDGE_SOCKET_ENV_VAR]
  if (override !== undefined && override.length > 0) return override
  return platform === "win32" ? DEFAULT_BRIDGE_SOCKET_WIN32 : DEFAULT_BRIDGE_SOCKET_POSIX
}

interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number; result: unknown; error?: never }
  | { jsonrpc: "2.0"; id: number; error: JsonRpcError; result?: never }

const ERROR_CODES: Record<number, string> = {
  [-32700]: "PARSE_ERROR",
  [-32600]: "INVALID_REQUEST",
  [-32601]: "UNKNOWN_METHOD",
  [-32001]: "GAME_NOT_RUNNING",
  [-32002]: "INSTANCE_BUSY",
  [-32003]: "PROTOCOL_MISMATCH",
  [-32004]: "STATE_STALE",
  [-32005]: "STATE_NOT_FOUND",
  [-32010]: "WRONG_PHASE",
  [-32011]: "INVALID_TARGET",
  [-32012]: "INSUFFICIENT_FUNDS",
  [-32013]: "SLOTS_FULL",
  [-32014]: "ETERNAL_BLOCKED",
  [-32015]: "PACK_LIMIT_REACHED",
  [-32017]: "VOUCHER_DEPENDENCY",
  [-32018]: "CANNOT_USE_NOW",
  [-32032]: "INTERNAL_ERROR",
}

export function errorCodeToString(code: number): string {
  return ERROR_CODES[code] ?? "UNKNOWN_ERROR"
}

export function serializeFrame(request: JsonRpcRequest): string {
  return JSON.stringify(request) + "\n"
}

export function parseFrames(buffer: string): { messages: unknown[]; remainder: string } {
  const boundary = buffer.lastIndexOf("\n")
  if (boundary === -1) return { messages: [], remainder: buffer }

  const messages: unknown[] = []
  for (const line of buffer.slice(0, boundary).split("\n")) {
    if (line.trim() === "") continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      // The peer owns malformed frames; the pending request will time out.
    }
  }
  return { messages, remainder: buffer.slice(boundary + 1) }
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (typeof value !== "object" || value === null) return false
  const response = value as Record<string, unknown>
  if (response.jsonrpc !== "2.0" || typeof response.id !== "number") return false
  return "result" in response !== "error" in response
}
