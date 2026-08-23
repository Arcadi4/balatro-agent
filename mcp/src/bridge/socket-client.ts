import { createConnection, type Socket } from "node:net"

import {
  errorCodeToString,
  isJsonRpcResponse,
  parseFrames,
  resolveBridgeSocketPath,
  serializeFrame,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js"

const DEFAULT_SOCKET_PATH = resolveBridgeSocketPath()
const PROTOCOL_VERSION = 1
const RESPONSE_TIMEOUT_MS = 10_000
const STATE_TIMEOUT_MS = 5_000
const RECONNECT_DELAY_MS = 500
const BUSY_RECONNECT_DELAY_MS = 2_000

interface PendingRequest {
  promise: Promise<JsonRpcResponse>
  resolve: (response: JsonRpcResponse) => void
  reject: (error: Error) => void
  timeout?: Timer
}

export interface StateEnvelope {
  protocol_version: number
  seq: number
  wrote_at: string
  payload: unknown
  state_hash: string
}

export interface CommandEnvelope {
  protocol_version: number
  seq: number
  wrote_at: number
  kind: string
  args: Record<string, unknown>
}

export interface ResponseEnvelope {
  ok: boolean
  error_code?: string
  error_message?: string
  data?: unknown
  seq: number
  applied_state_seq?: number
}

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

function errnoCode(error: Error): string | undefined {
  return (error as ErrnoException).code
}

function isConnectionUnavailable(error: Error): boolean {
  return errnoCode(error) === "ECONNREFUSED" || errnoCode(error) === "ENOENT"
}

function isInstanceBusyError(error: Error): boolean {
  return errnoCode(error) === "EBUSY"
}

function isConnectionSevered(error: Error): boolean {
  const code = errnoCode(error)
  return code === "EPIPE" || code === "ECONNRESET" || code === "ECONNABORTED"
}

function gameNotRunning(message = "Balatro is not running"): BridgeError {
  return new BridgeError("GAME_NOT_RUNNING", message)
}

function instanceBusy(): BridgeError {
  return new BridgeError("INSTANCE_BUSY", "Balatro bridge is connected to another client")
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function bridgeErrorCode(error: { code: number; data?: unknown }): string {
  const data = asRecord(error.data)
  return typeof data?.error_code === "string" ? data.error_code : errorCodeToString(error.code)
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export class BridgeClient {
  private readonly socketPath: string
  private socket?: Socket
  private decoder = new TextDecoder()
  private bytesRead = 0
  private commandSeq = 0
  private connectionGeneration = 0
  private connected = false
  private disposed = false
  private buffer = ""
  private connectPromise?: Promise<void>
  private connectResolve?: () => void
  private connectReject?: (error: Error) => void
  private reconnectTimer?: Timer
  private connectedAtMs?: number
  private lastDisconnectError?: BridgeError
  private socketError?: Error
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(socketPath = DEFAULT_SOCKET_PATH) {
    this.socketPath = socketPath
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.disposed) return Promise.reject(gameNotRunning("BridgeClient has been disposed"))
    if (this.connectPromise) return this.connectPromise

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.connectPromise = promise
    this.connectResolve = resolve
    this.connectReject = reject
    this.openSocket()

    return promise
  }

  async getState(): Promise<Record<string, unknown>>
  async getState(timeoutMs: number): Promise<Record<string, unknown>>
  async getState(options: { maxAgeMs?: number }): Promise<StateEnvelope>
  async getState(
    timeoutOrOptions: number | { maxAgeMs?: number } = STATE_TIMEOUT_MS,
  ): Promise<Record<string, unknown> | StateEnvelope> {
    const timeoutMs = typeof timeoutOrOptions === "number" ? timeoutOrOptions : STATE_TIMEOUT_MS
    const result = asRecord(await this.request("get_state", undefined, timeoutMs))
    if (!result) throw new BridgeError("STATE_NOT_FOUND", "State response is not an object")
    if (result.protocol_version !== PROTOCOL_VERSION) {
      throw new BridgeError(
        "PROTOCOL_MISMATCH",
        `Expected bridge protocol ${PROTOCOL_VERSION}, got ${String(result.protocol_version)}`,
      )
    }

    if (typeof timeoutOrOptions === "object") {
      if (!asRecord(result.payload)) {
        throw new BridgeError("STATE_NOT_FOUND", "State response has no payload")
      }
      return result as unknown as StateEnvelope
    }

    const payload = asRecord(result.payload)
    if (!payload) throw new BridgeError("STATE_NOT_FOUND", "State response has no payload")
    return payload
  }

  async command(
    kind: string,
    args?: Record<string, unknown>,
    timeoutMs = RESPONSE_TIMEOUT_MS,
  ): Promise<unknown> {
    const result = asRecord(await this.request(kind, args ?? {}, timeoutMs))
    if (!result || result.ok !== true) {
      throw new BridgeError("PROTOCOL_MISMATCH", `Command ${kind} returned an invalid result`)
    }
    return result.data
  }

  async sendCommand(options: {
    kind: string
    args?: Record<string, unknown>
  }): Promise<number> {
    this.assertConnected()
    const id = ++this.commandSeq
    const pending = this.createPendingRequest(id)
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: options.kind,
      ...(options.args === undefined ? {} : { params: options.args }),
    }

    try {
      await this.writeFrame(request)
      return id
    } catch (cause) {
      const error = this.normalizeRequestError(cause)
      this.rejectAndDeletePending(id, error)
      throw error
    }
  }

  async awaitResponse(
    seq: number,
    options: { timeoutMs?: number } = {},
  ): Promise<ResponseEnvelope> {
    const pending = this.pendingRequests.get(seq)
    if (!pending) throw new BridgeError("STATE_NOT_FOUND", `No pending bridge request ${seq}`)

    try {
      const response = await this.awaitJsonRpcResponse(
        seq,
        pending,
        options.timeoutMs ?? RESPONSE_TIMEOUT_MS,
      )
      if (response.error) {
        throw new BridgeError(bridgeErrorCode(response.error), response.error.message)
      }
      const result = asRecord(response.result)
      if (!result || typeof result.ok !== "boolean") {
        throw new BridgeError("PROTOCOL_MISMATCH", "Bridge command returned an invalid result")
      }
      return {
        ok: result.ok,
        error_code: typeof result.error_code === "string" ? result.error_code : undefined,
        error_message: typeof result.error_message === "string" ? result.error_message : undefined,
        data: result.data,
        seq,
        applied_state_seq:
          typeof result.applied_state_seq === "number" ? result.applied_state_seq : undefined,
      }
    } catch (cause) {
      throw this.normalizeRequestError(cause)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.clearReconnectTimer()
    const closed = gameNotRunning()
    this.rejectAllPending(closed)

    if (this.connectReject) {
      this.connectReject(closed)
      this.clearConnectPromise()
    }

    this.connected = false
    this.connectedAtMs = undefined
    this.lastDisconnectError = undefined
    this.socketError = undefined
    this.buffer = ""
    this.bytesRead = 0
    this.connectionGeneration += 1
    this.socket?.destroy()
    this.socket = undefined
  }

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    this.assertConnected()

    const id = ++this.commandSeq
    const pending = this.createPendingRequest(id, timeoutMs)
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }

    try {
      await this.writeFrame(request)
      const response = await this.awaitJsonRpcResponse(id, pending)
      if (response.error) {
        throw new BridgeError(bridgeErrorCode(response.error), response.error.message)
      }
      return response.result
    } catch (cause) {
      const error = this.normalizeRequestError(cause)
      this.rejectAndDeletePending(id, error)
      throw error
    }
  }

  private normalizeRequestError(cause: unknown): Error {
    const error = toError(cause)
    if (error instanceof BridgeError) return error
    if (isConnectionUnavailable(error)) return gameNotRunning()
    if (isConnectionSevered(error)) return this.interruptionError()
    return error
  }

  private openSocket(): void {
    this.clearReconnectTimer()
    this.buffer = ""
    this.decoder = new TextDecoder()
    this.bytesRead = 0
    this.socketError = undefined

    const socket = createConnection(this.socketPath)
    this.socket = socket
    socket.once("connect", () => {
      if (this.disposed || this.socket !== socket) {
        socket.destroy()
        return
      }
      this.connectionGeneration += 1
      this.connected = true
      this.connectedAtMs = Date.now()
      this.lastDisconnectError = undefined
      this.connectResolve?.()
      this.clearConnectPromise()
    })
    socket.on("data", (data) => {
      if (this.socket !== socket) return
      if (typeof data === "string") {
        this.bytesRead += data.length
        this.handleData(data)
        return
      }
      this.bytesRead += data.byteLength
      this.handleData(this.decoder.decode(data, { stream: true }))
    })
    socket.on("error", (error) => {
      if (this.socket === socket) this.handleSocketError(error)
    })
    // A peer that closes right after accept (the bridge rejects extra
    // clients this way) half-closes the connection: 'end' arrives but the
    // pending write callback and 'close' may never fire on their own.
    // Force the close so pending requests are rejected and reconnection
    // runs instead of hanging forever.
    socket.on("end", () => {
      if (this.socket === socket) socket.destroy()
    })
    socket.once("close", () => {
      if (this.socket === socket) this.handleSocketClose(this.socketError)
    })
  }

  private normalizeConnectError(error: Error): BridgeError {
    if (error instanceof BridgeError) return error
    if (isInstanceBusyError(error)) return instanceBusy()
    return isConnectionUnavailable(error)
      ? gameNotRunning()
      : gameNotRunning(`Connection failed: ${error.message}`)
  }

  private handleSocketError(error: Error): void {
    this.socketError = error
    if (this.connectReject) {
      this.connectReject(this.normalizeConnectError(error))
      this.clearConnectPromise()
    } else {
      process.stderr.write(`[balatro-mcp] bridge socket: ${error.message}\n`)
    }
  }

  private handleSocketClose(closeError?: Error): void {
    const socket = this.socket
    const bytesRead = this.bytesRead
    this.connectionGeneration += 1
    this.socket = undefined
    this.connected = false
    this.buffer = ""
    this.bytesRead = 0
    this.socketError = undefined

    const error = closeError
      ? this.closeError(closeError)
      : this.socketCloseError(socket, bytesRead)
    this.lastDisconnectError = error
    this.rejectAllPending(error)

    if (this.connectReject) {
      this.connectReject(error)
      this.clearConnectPromise()
    }
    if (!this.disposed) this.scheduleReconnect()
  }

  private closeError(error: Error): BridgeError {
    if (error instanceof BridgeError) return error
    if (isInstanceBusyError(error)) return instanceBusy()
    if (isConnectionUnavailable(error) || isConnectionSevered(error)) return gameNotRunning()
    return gameNotRunning(`Connection closed: ${error.message}`)
  }

  private socketCloseError(socket: Socket | undefined, bytesRead: number): BridgeError {
    const connectedForMs = this.connectionAge()
    return socket &&
      bytesRead === 0 &&
      connectedForMs !== undefined &&
      connectedForMs < RECONNECT_DELAY_MS
      ? instanceBusy()
      : gameNotRunning()
  }

  private interruptionError(): BridgeError {
    const connectedForMs = this.connectionAge(false)
    return connectedForMs !== undefined && connectedForMs < RECONNECT_DELAY_MS
      ? instanceBusy()
      : gameNotRunning()
  }

  private connectionAge(clear = true): number | undefined {
    const age = this.connectedAtMs === undefined ? undefined : Date.now() - this.connectedAtMs
    if (clear) this.connectedAtMs = undefined
    return age
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay =
      this.lastDisconnectError?.code === "INSTANCE_BUSY"
        ? BUSY_RECONNECT_DELAY_MS
        : RECONNECT_DELAY_MS
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (!this.disposed && !this.connected) this.openSocket()
    }, delay)
  }

  private handleData(chunk: string): void {
    const parsed = parseFrames(this.buffer + chunk)
    this.buffer = parsed.remainder
    for (const message of parsed.messages) {
      if (!isJsonRpcResponse(message)) continue
      this.pendingRequests.get(message.id)?.resolve(message)
    }
  }

  private writeFrame(request: JsonRpcRequest): Promise<void> {
    const socket = this.socket
    const generation = this.connectionGeneration
    const write = this.writeQueue.then(() => this.writeFrameNow(request, socket, generation))
    this.writeQueue = write.catch(() => undefined)
    return write
  }

  private async writeFrameNow(
    request: JsonRpcRequest,
    socket: Socket | undefined,
    generation: number,
  ): Promise<void> {
    if (
      !this.connected ||
      !socket ||
      this.socket !== socket ||
      this.connectionGeneration !== generation ||
      socket.destroyed ||
      !socket.writable
    ) {
      throw this.lastDisconnectError ?? gameNotRunning()
    }

    // The write callback can be abandoned when the peer half-closes right
    // after accept (see openSocket's 'end' handler). Reject on 'close' too
    // so a queued write never hangs its caller.
    await new Promise<void>((resolve, reject) => {
      const onClose = () => {
        reject(this.lastDisconnectError ?? gameNotRunning("Bridge connection closed before the command was written"))
      }
      socket.once("close", onClose)
      socket.write(serializeFrame(request), (error) => {
        socket.removeListener("close", onClose)
        if (error) {
          reject(error)
        } else if (this.socket !== socket || this.connectionGeneration !== generation) {
          reject(gameNotRunning("Bridge connection changed before the command was written"))
        } else {
          resolve()
        }
      })
    })
  }

  private createPendingRequest(id: number, timeoutMs?: number): PendingRequest {
    const { promise, resolve, reject } = Promise.withResolvers<JsonRpcResponse>()
    void promise.catch(() => undefined)
    const pending: PendingRequest = { promise, resolve, reject }
    this.pendingRequests.set(id, pending)
    // Arm the timeout at creation time so it covers the write phase too:
    // a write that hangs (peer half-close before the callback fires) must
    // still let the request settle.
    if (timeoutMs !== undefined) {
      pending.timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        pending.reject(new BridgeError("STATE_STALE", "Bridge response timed out"))
      }, timeoutMs)
    }
    return pending
  }

  private async awaitJsonRpcResponse(
    id: number,
    pending: PendingRequest,
    timeoutMs?: number,
  ): Promise<JsonRpcResponse> {
    if (timeoutMs !== undefined) {
      pending.timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        pending.reject(new BridgeError("STATE_STALE", "Bridge response timed out"))
      }, timeoutMs)
    }

    try {
      return await pending.promise
    } finally {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(id)
    }
  }

  private rejectAndDeletePending(id: number, error: Error): void {
    const pending = this.pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pending.reject(error)
    this.pendingRequests.delete(id)
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private clearReconnectTimer(): void {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private clearConnectPromise(): void {
    this.connectPromise = undefined
    this.connectResolve = undefined
    this.connectReject = undefined
  }

  private assertConnected(): void {
    if (!this.connected) throw this.lastDisconnectError ?? gameNotRunning()
  }
}
