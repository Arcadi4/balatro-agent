import { createConnection } from "node:net";
import type { Socket } from "node:net";

import {
  errorCodeToString,
  isJsonRpcResponse,
  parseFrames,
  serializeFrame,
} from "./protocol.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol.js";

const SOCKET_PATH = "/tmp/balatro-mcp.sock";
const PROTOCOL_VERSION = 1;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;
const DEFAULT_STATE_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 500;

export interface BridgeConfig {
  bridgeDir?: string;
}

export interface Heartbeat {
  protocol_version: number;
  seq: number;
  phase: string;
  wrote_at: number;
  mod_version: string;
}

export interface StateEnvelope {
  protocol_version: number;
  seq: number;
  wrote_at: string;
  payload: unknown;
  state_hash: string;
}

export interface CommandEnvelope {
  protocol_version: number;
  seq: number;
  wrote_at: number;
  kind: string;
  args: Record<string, unknown>;
}

export interface ResponseEnvelope {
  ok: boolean;
  error_code?: string;
  error_message?: string;
  data?: unknown;
  seq: number;
  applied_state_seq?: number;
}

export interface ClientLock {
  pid: number;
  start_time: number;
}

interface PendingRequest {
  promise: Promise<JsonRpcResponse>;
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

function errnoCode(err: Error): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

function isConnectionUnavailable(err: Error): boolean {
  const code = errnoCode(err);
  return code === "ECONNREFUSED" || code === "ENOENT" || code === "EPIPE" || code === "ECONNRESET";
}

function gameNotRunningError(message = "Balatro is not running"): BridgeError {
  return new BridgeError("GAME_NOT_RUNNING", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAppliedStateSeq(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.applied_state_seq === "number" ? value.applied_state_seq : undefined;
}

function normalizeWroteAt(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return new Date().toISOString();
}

function normalizeStateHash(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasPayload(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

export class BridgeClient {
  private socket?: Socket;
  private commandSeq = 0;
  private connected = false;
  private disposed = false;
  private buffer = "";
  private connectPromise?: Promise<void>;
  private connectResolve?: () => void;
  private connectReject?: (error: Error) => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly pendingRequests = new Map<number, PendingRequest>();

  constructor(_config?: BridgeConfig) {
  }

  get dir(): string {
    return SOCKET_PATH;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.disposed) {
      return Promise.reject(gameNotRunningError("BridgeClient has been disposed"));
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.openSocket();
    });

    return this.connectPromise;
  }

  async getState(options?: { maxAgeMs?: number }): Promise<StateEnvelope> {
    this.assertConnected();

    const id = this.nextId();
    const pending = this.createPendingRequest(id);
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "get_state",
    };

    try {
      await this.writeFrame(request);
      const response = await this.awaitJsonRpcResponse(
        id,
        pending,
        options?.maxAgeMs ?? DEFAULT_STATE_TIMEOUT_MS,
      );

      if (response.error) {
        throw new BridgeError(errorCodeToString(response.error.code), response.error.message);
      }

      const result = response.result;
      if (!isRecord(result)) {
        throw new BridgeError("STATE_NOT_FOUND", "State response missing result object");
      }

      if (result.protocol_version !== PROTOCOL_VERSION) {
        throw new BridgeError(
          "PROTOCOL_MISMATCH",
          `Expected protocol version ${PROTOCOL_VERSION}, got ${String(result.protocol_version)}`,
        );
      }

      if (typeof result.seq !== "number") {
        throw new BridgeError("STATE_NOT_FOUND", "State envelope missing required field seq");
      }

      if (!hasPayload(result.payload)) {
        throw new BridgeError("STATE_NOT_FOUND", "State envelope missing required payload");
      }

      return {
        protocol_version: result.protocol_version,
        seq: result.seq,
        wrote_at: normalizeWroteAt(result.wrote_at),
        payload: result.payload,
        state_hash: normalizeStateHash(result.state_hash),
      };
    } catch (err) {
      this.rejectAndDeletePending(id, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async sendCommand(options: {
    kind: string;
    args?: Record<string, unknown>;
    ttlMs?: number;
  }): Promise<number> {
    this.assertConnected();

    const id = this.nextId();
    this.createPendingRequest(id);

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: options.kind,
      params: options.args ?? {},
    };

    try {
      await this.writeFrame(request);
      return id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.rejectAndDeletePending(id, error);
      throw isConnectionUnavailable(error) ? gameNotRunningError("Balatro is not running") : error;
    }
  }

  async awaitResponse(
    seq: number,
    options?: { timeoutMs?: number },
  ): Promise<ResponseEnvelope> {
    this.assertConnected();

    const pending = this.pendingRequests.get(seq);
    if (!pending) {
      throw new BridgeError("STATE_NOT_FOUND", `No pending request for seq ${seq}`);
    }

    const response = await this.awaitJsonRpcResponse(
      seq,
      pending,
      options?.timeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
    );

    if (response.error) {
      return {
        ok: false,
        error_code: errorCodeToString(response.error.code),
        error_message: response.error.message,
        seq,
      };
    }

    return {
      ok: true,
      data: response.result,
      seq,
      applied_state_seq: extractAppliedStateSeq(response.result),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.clearReconnectTimer();
    this.rejectAllPending(gameNotRunningError("Balatro is not running"));

    if (this.connectReject) {
      this.connectReject(gameNotRunningError("Balatro is not running"));
      this.clearConnectPromise();
    }

    this.connected = false;
    this.buffer = "";

    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
  }

  private openSocket(): void {
    this.clearReconnectTimer();
    this.buffer = "";

    const socket = createConnection({ path: SOCKET_PATH });
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("connect", () => {
      if (this.socket !== socket) return;

      this.connected = true;
      this.commandSeq = 0;
      this.connectResolve?.();
      this.clearConnectPromise();
    });

    socket.on("data", (chunk: string | Buffer) => {
      this.handleData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });

    socket.on("error", (err: Error) => {
      this.handleSocketError(err);
    });

    socket.on("close", () => {
      this.handleSocketClose(socket);
    });
  }

  private handleSocketError(err: Error): void {
    if (this.connectReject && isConnectionUnavailable(err)) {
      this.connectReject(gameNotRunningError("Balatro is not running"));
      this.clearConnectPromise();
      return;
    }

    process.stderr.write(`Balatro MCP bridge socket error: ${err.message}\n`);
  }

  private handleSocketClose(socket: Socket): void {
    if (this.socket !== socket) return;

    this.socket = undefined;
    this.connected = false;
    this.buffer = "";
    this.rejectAllPending(gameNotRunningError("Balatro is not running"));

    if (this.connectReject) {
      this.connectReject(gameNotRunningError("Balatro is not running"));
      this.clearConnectPromise();
    }

    if (!this.disposed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.disposed && !this.connected) {
        this.openSocket();
      }
    }, RECONNECT_DELAY_MS);
  }

  private handleData(chunk: string): void {
    const parsed = parseFrames(this.buffer + chunk);
    this.buffer = parsed.remainder;

    for (const message of parsed.messages) {
      if (!isJsonRpcResponse(message)) continue;

      const pending = this.pendingRequests.get(message.id);
      if (!pending) continue;

      pending.resolve(message);
    }
  }

  private async writeFrame(request: JsonRpcRequest): Promise<void> {
    const socket = this.socket;
    if (!this.connected || !socket || socket.destroyed) {
      throw gameNotRunningError("Balatro is not running");
    }

    const frame = serializeFrame(request);
    const wroteImmediately = socket.write(frame);
    if (wroteImmediately) return;

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off("drain", onDrain);
        socket.off("error", onError);
      };
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };

      socket.once("drain", onDrain);
      socket.once("error", onError);
    });
  }

  private nextId(): number {
    this.commandSeq += 1;
    return this.commandSeq;
  }

  private createPendingRequest(id: number): PendingRequest {
    let resolvePending: (response: JsonRpcResponse) => void = () => undefined;
    let rejectPending: (error: Error) => void = () => undefined;
    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    void promise.catch(() => undefined);

    const pending: PendingRequest = {
      promise,
      resolve: resolvePending,
      reject: rejectPending,
    };
    this.pendingRequests.set(id, pending);
    return pending;
  }

  private async awaitJsonRpcResponse(
    id: number,
    pending: PendingRequest,
    timeoutMs: number,
  ): Promise<JsonRpcResponse> {
    if (pending.timeout) clearTimeout(pending.timeout);

    pending.timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      pending.reject(new BridgeError("STATE_STALE", "Response timeout"));
    }, timeoutMs);

    try {
      return await pending.promise;
    } finally {
      if (pending.timeout) clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
    }
  }

  private rejectAndDeletePending(id: number, error: Error): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    if (pending.timeout) clearTimeout(pending.timeout);
    pending.reject(error);
    this.pendingRequests.delete(id);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearConnectPromise(): void {
    this.connectPromise = undefined;
    this.connectResolve = undefined;
    this.connectReject = undefined;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw gameNotRunningError("Balatro is not running");
    }
  }
}
