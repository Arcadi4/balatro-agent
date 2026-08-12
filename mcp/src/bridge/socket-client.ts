/**
 * socket-client.ts — Unix socket bridge client (Bun native sockets).
 *
 * Talks to the Balatro mod's JSON-RPC server over the Unix socket at
 * `/tmp/balatro-mcp.sock` using newline-delimited JSON frames (see
 * protocol.ts). Built on `Bun.connect` with `binaryType: "uint8array"`;
 * incoming bytes are decoded incrementally with a streaming `TextDecoder`
 * so multi-byte UTF-8 code points split across socket reads stay intact.
 *
 * Wire behavior mirrors the previous `node:net` implementation:
 * - `GAME_NOT_RUNNING` when the socket is unavailable or the peer closed the
 *   connection with no data exchanged after a healthy connection.
 * - `INSTANCE_BUSY` when the peer closes a freshly established connection
 *   before any data was exchanged (the Lua bridge rejects extra clients).
 * - Transparent background reconnection: after an unexpected close the client
 *   retries every RECONNECT_DELAY_MS until reconnected or disposed.
 */
import type { Socket } from "bun";

import { errorCodeToString, isJsonRpcResponse, parseFrames, serializeFrame } from "./protocol.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol.js";

const SOCKET_PATH = "/tmp/balatro-mcp.sock";
const PROTOCOL_VERSION = 1;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;
const DEFAULT_STATE_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 500;

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

interface PendingRequest {
  promise: Promise<JsonRpcResponse>;
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout?: Timer;
}

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

function errnoCode(err: Error): string | undefined {
  return (err as ErrnoException).code;
}

function isConnectionUnavailable(err: Error): boolean {
  const code = errnoCode(err);
  return code === "ECONNREFUSED" || code === "ENOENT";
}

function isConnectionSevered(err: Error): boolean {
  const code = errnoCode(err);
  return code === "EPIPE" || code === "ECONNRESET";
}

function gameNotRunningError(message = "Balatro is not running"): BridgeError {
  return new BridgeError("GAME_NOT_RUNNING", message);
}

function instanceBusyError(
  message = "Balatro bridge is already connected to another client",
): BridgeError {
  return new BridgeError("INSTANCE_BUSY", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAppliedStateSeq(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.applied_state_seq === "number" ? value.applied_state_seq : undefined;
}

function unwrapActionResultData(value: unknown): unknown {
  if (!isRecord(value) || value.ok !== true || !("data" in value)) return value;
  return value.data;
}

function jsonRpcErrorCode(error: JsonRpcResponse["error"]): string {
  if (!error) return "UNKNOWN_ERROR";
  if (isRecord(error.data) && typeof error.data.error_code === "string") {
    return error.data.error_code;
  }
  return errorCodeToString(error.code);
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
  private decoder = new TextDecoder();
  private bytesRead = 0;
  private commandSeq = 0;
  private connected = false;
  private disposed = false;
  private buffer = "";
  private connectPromise?: Promise<void>;
  private connectResolve?: () => void;
  private connectReject?: (error: Error) => void;
  private reconnectTimer?: Timer;
  private connectedAtMs?: number;
  private lastDisconnectError?: BridgeError;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private drainWaiters: Array<() => void> = [];
  private drainRejecters: Array<(error: Error) => void> = [];
  // Serializes outbound frames: Bun socket writes are unbuffered, so a
  // partial write resumes after `drain`. Without a queue, a concurrent call
  // could interleave its own frame between the partial write and the resume,
  // corrupting the NDJSON stream. Every frame is written atomically.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {}

  get dir(): string {
    return SOCKET_PATH;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.disposed) {
      return Promise.reject(gameNotRunningError("BridgeClient has been disposed"));
    }
    if (this.connectPromise) return this.connectPromise;

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.connectPromise = promise;
    this.connectResolve = resolve;
    this.connectReject = reject;
    this.openSocket();
    // Return the local, not `this.connectPromise`: Bun fires `connectError`
    // synchronously during `openSocket()`, and the error path clears the
    // field before this line runs. Returning the field would hand the caller
    // `undefined` (await resolves) and orphan the rejected promise.
    return promise;
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
        throw new BridgeError(jsonRpcErrorCode(response.error), response.error.message);
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
      if (error instanceof BridgeError) throw error;
      if (isConnectionUnavailable(error)) throw gameNotRunningError("Balatro is not running");
      if (isConnectionSevered(error)) throw this.errorForConnectionInterrupted();
      throw error;
    }
  }

  async awaitResponse(seq: number, options?: { timeoutMs?: number }): Promise<ResponseEnvelope> {
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
        error_code: jsonRpcErrorCode(response.error),
        error_message: response.error.message,
        seq,
      };
    }

    return {
      ok: true,
      data: unwrapActionResultData(response.result),
      seq,
      applied_state_seq: extractAppliedStateSeq(response.result),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.clearReconnectTimer();
    this.rejectAllPending(gameNotRunningError("Balatro is not running"));
    this.rejectDrainWaiters(gameNotRunningError("Balatro is not running"));

    if (this.connectReject) {
      this.connectReject(gameNotRunningError("Balatro is not running"));
      this.clearConnectPromise();
    }

    this.connected = false;
    this.connectedAtMs = undefined;
    this.lastDisconnectError = undefined;
    this.buffer = "";
    this.bytesRead = 0;

    if (this.socket) {
      this.socket.terminate();
      this.socket = undefined;
    }
  }

  private openSocket(): void {
    this.clearReconnectTimer();
    this.buffer = "";
    this.decoder = new TextDecoder();
    this.bytesRead = 0;

    void Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        open: (socket) => {
          this.socket = socket;
          this.connected = true;
          this.connectedAtMs = Date.now();
          this.lastDisconnectError = undefined;
          this.commandSeq = 0;
          this.connectResolve?.();
          this.clearConnectPromise();
        },
        data: (_socket, data) => {
          this.bytesRead += data.byteLength;
          this.handleData(this.decoder.decode(data, { stream: true }));
        },
        drain: () => {
          this.handleDrain();
        },
        close: (socket, error) => {
          if (this.socket !== socket) return;
          this.handleSocketClose(error);
        },
        error: (_socket, error) => {
          this.handleSocketError(error);
        },
        connectError: (_socket, error) => {
          this.handleConnectError(error);
        },
      },
    })
      .then((socket) => {
        // `connectError` already ran; the rejected promise is only for
        // reporting. If we were disposed while connecting, close the socket.
        if (this.disposed) socket.terminate();
      })
      .catch((error: unknown) => {
        this.handleConnectError(error instanceof Error ? error : new Error(String(error)));
      });
  }

  private handleConnectError(error: Error): void {
    const bridgeError = this.normalizeConnectError(error);

    if (this.connectReject) {
      this.connectReject(bridgeError);
      this.clearConnectPromise();
    }

    if (!this.disposed && !this.connected) {
      this.lastDisconnectError = bridgeError;
      this.scheduleReconnect();
    }
  }

  private normalizeConnectError(error: Error): BridgeError {
    if (error instanceof BridgeError) return error;
    if (isConnectionUnavailable(error)) return gameNotRunningError("Balatro is not running");
    return new BridgeError("GAME_NOT_RUNNING", `Connection failed: ${error.message}`);
  }

  private handleSocketError(error: Error): void {
    // Reject in-flight write waits so they fail fast instead of hanging;
    // the close handler follows and tears down pending requests.
    this.rejectDrainWaiters(error);
    process.stderr.write(`Balatro MCP bridge socket error: ${error.message}\n`);
  }

  private handleSocketClose(closeError?: Error): void {
    const socket = this.socket;
    const bytesRead = this.bytesRead;
    this.socket = undefined;
    this.connected = false;
    this.buffer = "";
    this.bytesRead = 0;

    const error = closeError ? this.errorForClose(closeError) : this.errorForSocketClose(socket, bytesRead);

    this.lastDisconnectError = error;
    this.rejectAllPending(error);
    this.rejectDrainWaiters(error);

    if (this.connectReject) {
      this.connectReject(error);
      this.clearConnectPromise();
    }

    if (!this.disposed && error.code !== "INSTANCE_BUSY") {
      this.scheduleReconnect();
    }
  }

  private errorForClose(closeError: Error): BridgeError {
    if (closeError instanceof BridgeError) return closeError;
    if (isConnectionUnavailable(closeError) || isConnectionSevered(closeError)) {
      return gameNotRunningError("Balatro is not running");
    }
    return gameNotRunningError(`Connection closed: ${closeError.message}`);
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

  private errorForSocketClose(socket: Socket | undefined, bytesRead: number): BridgeError {
    const connectedForMs =
      this.connectedAtMs === undefined ? undefined : Date.now() - this.connectedAtMs;
    this.connectedAtMs = undefined;

    return bytesRead === 0 &&
      connectedForMs !== undefined &&
      connectedForMs < RECONNECT_DELAY_MS
      ? instanceBusyError()
      : gameNotRunningError("Balatro is not running");
  }

  private errorForConnectionInterrupted(): BridgeError {
    const connectedForMs =
      this.connectedAtMs === undefined ? undefined : Date.now() - this.connectedAtMs;
    return connectedForMs !== undefined && connectedForMs < RECONNECT_DELAY_MS
      ? instanceBusyError()
      : gameNotRunningError("Balatro is not running");
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

  private handleDrain(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    this.drainRejecters = [];
    for (const resolve of waiters) resolve();
  }

  private rejectDrainWaiters(error: Error): void {
    const rejecters = this.drainRejecters;
    this.drainWaiters = [];
    this.drainRejecters = [];
    for (const reject of rejecters) reject(error);
  }

  private writeFrame(request: JsonRpcRequest): Promise<void> {
    const write = this.writeQueue.then(() => this.writeFrameNow(request));
    // Keep the chain alive across failures so a closed socket doesn't wedge
    // every later write; callers still observe the rejection via `write`.
    this.writeQueue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  private async writeFrameNow(request: JsonRpcRequest): Promise<void> {
    const socket = this.socket;
    // readyState <= 0 means Shutdown/Detached/Closed; only positive values
    // indicate an open, usable socket.
    if (!this.connected || !socket || socket.readyState <= 0) {
      if (this.lastDisconnectError) throw this.lastDisconnectError;
      throw gameNotRunningError("Balatro is not running");
    }

    const frame = serializeFrame(request);
    let offset = 0;
    while (offset < frame.length) {
      const written = socket.write(frame.slice(offset));
      if (written === -1) {
        if (this.lastDisconnectError) throw this.lastDisconnectError;
        throw gameNotRunningError("Balatro is not running");
      }
      offset += written;
      if (offset < frame.length) {
        await this.waitForDrain();
      }
    }
  }

  private waitForDrain(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.drainWaiters.push(resolve);
    this.drainRejecters.push(reject);
    return promise;
  }

  private nextId(): number {
    this.commandSeq += 1;
    return this.commandSeq;
  }

  private createPendingRequest(id: number): PendingRequest {
    const { promise, resolve, reject } = Promise.withResolvers<JsonRpcResponse>();
    void promise.catch(() => undefined);

    const pending: PendingRequest = { promise, resolve, reject };
    this.pendingRequests.set(id, pending);
    return pending;
  }

  private async awaitJsonRpcResponse(
    id: number,
    pending: PendingRequest,
    timeoutMs: number,
  ): Promise<JsonRpcResponse> {
    clearTimeout(pending.timeout);

    pending.timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      pending.reject(new BridgeError("STATE_STALE", "Response timeout"));
    }, timeoutMs);

    try {
      return await pending.promise;
    } finally {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
    }
  }

  private rejectAndDeletePending(id: number, error: Error): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    pending.reject(error);
    this.pendingRequests.delete(id);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private clearReconnectTimer(): void {
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
      if (this.lastDisconnectError) throw this.lastDisconnectError;
      throw gameNotRunningError("Balatro is not running");
    }
  }
}
