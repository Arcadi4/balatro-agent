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
const RESPONSE_TIMEOUT_MS = 10_000
const STATE_TIMEOUT_MS = 5_000
const HANDSHAKE_TIMEOUT_MS = 10_000

interface PendingRequest {
  promise: Promise<JsonRpcResponse>
  resolve: (response: JsonRpcResponse) => void
  reject: (error: Error) => void
  timeout?: Timer
}

export interface StateEnvelope {
  seq: number
  wrote_at: string
  payload: unknown
  state_hash: string
}

export interface ResponseEnvelope {
  ok: boolean
  error_code?: string
  error_message?: string
  data?: unknown
  seq: number
  applied_state_seq?: number
}

export interface ConnectInfo {
  phase?: string
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

function errnoCode(error: Error | undefined): string | undefined {
  return error === undefined ? undefined : (error as ErrnoException).code
}

function isConnectionUnavailable(error: Error | undefined): boolean {
  return errnoCode(error) === "ECONNREFUSED" || errnoCode(error) === "ENOENT"
}

function isInstanceBusyError(error: Error | undefined): boolean {
  return errnoCode(error) === "EBUSY"
}

function isConnectionSevered(error: Error | undefined): boolean {
  const code = errnoCode(error)
  return code === "EPIPE" || code === "ECONNRESET" || code === "ECONNABORTED"
}

function gameNotRunning(message = "Balatro is not running"): BridgeError {
  return new BridgeError("GAME_NOT_RUNNING", message)
}

function instanceBusy(): BridgeError {
  return new BridgeError("INSTANCE_BUSY", "Balatro bridge is busy or held by another client")
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
  private handshaked = false
  private disposed = false
  private buffer = ""
  private connectPromise?: Promise<ConnectInfo>
  private connectInfo?: ConnectInfo
  private lastDisconnectError?: BridgeError
  private socketError?: Error
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private writeQueue: Promise<void> = Promise.resolve()

  /** Invoked when an established game session drops; never for failed dials. */
  onDisconnect?: () => void

  constructor(socketPath = DEFAULT_SOCKET_PATH) {
    this.socketPath = socketPath
  }

  isConnected(): boolean {
    return this.handshaked
  }

  /**
   * Returns the live handshake, shares concurrent attempts, and never reconnects
   * in the background. A dropped session requires another explicit `connect`.
   */
  connect(): Promise<ConnectInfo> {
    if (this.handshaked && this.connectInfo) return Promise.resolve(this.connectInfo)
    if (this.disposed) return Promise.reject(gameNotRunning("BridgeClient has been disposed"))
    if (this.connectPromise) return this.connectPromise

    const { promise, resolve, reject } = Promise.withResolvers<ConnectInfo>()
    this.connectPromise = promise
    void this.establish().then(resolve, (error: Error) => {
      if (this.connectPromise === promise) this.connectPromise = undefined
      // A handshake timeout leaves the socket open; destroy it before the next attempt.
      if (this.socket !== undefined && this.connected) this.socket.destroy()
      reject(error)
    })
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

  async sendCommand(options: { kind: string; args?: Record<string, unknown> }): Promise<number> {
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
    this.rejectAllPending(gameNotRunning())
    this.connected = false
    this.handshaked = false
    this.connectInfo = undefined
    this.buffer = ""
    this.bytesRead = 0
    this.connectionGeneration += 1
    this.socket?.destroy()
    this.socket = undefined
  }

  // A close before the handshake completes means another client owns the bridge's single slot.
  private async establish(): Promise<ConnectInfo> {
    await this.dial()
    let data: Record<string, unknown> | undefined
    try {
      data = asRecord(await this.command("connect", undefined, HANDSHAKE_TIMEOUT_MS))
    } catch (cause) {
      if (cause instanceof BridgeError) {
        if (cause.code === "UNKNOWN_METHOD") {
          throw new BridgeError(
            "PROTOCOL_MISMATCH",
            "Bridge mod does not support the connect handshake; update the Balatro mod",
          )
        }
        if (cause.code === "STATE_STALE") {
          throw new BridgeError(
            "INSTANCE_BUSY",
            "Balatro accepted the connection but did not answer the connect handshake",
          )
        }
      }
      throw cause
    }
    this.handshaked = true
    this.connectInfo = {
      ...(typeof data?.phase === "string" ? { phase: data.phase } : {}),
    }
    return this.connectInfo
  }

  private dial(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const socket = createConnection(this.socketPath)
    this.socket = socket
    this.attachSocketHandlers(socket)
    const onConnect = (): void => {
      socket.off("close", onClose)
      resolve()
    }
    const onClose = (): void => {
      socket.off("connect", onConnect)
      // handleSocketClose classifies first; use the generic error only as a fallback.
      reject(
        this.disposed ? gameNotRunning() : (this.lastDisconnectError ?? this.connectionError()),
      )
    }
    socket.once("connect", onConnect)
    socket.once("close", onClose)
    return promise
  }

  private attachSocketHandlers(socket: Socket): void {
    socket.once("connect", () => {
      if (this.disposed || this.socket !== socket) {
        socket.destroy()
        return
      }
      this.connectionGeneration += 1
      this.connected = true
      this.lastDisconnectError = undefined
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
      if (this.socket === socket) this.socketError = error
    })
    // Some peers half-close after rejecting a client: 'end' arrives while the
    // pending write and 'close' can remain unresolved. Force both to settle.
    socket.on("end", () => {
      if (this.socket === socket) socket.destroy()
    })
    socket.once("close", () => {
      if (this.socket === socket) this.handleSocketClose(this.socketError)
    })
  }

  // Before the handshake, a refusal means the single game slot is busy; after
  // it, a close means the game or mod is gone.
  private connectionError(cause?: Error): BridgeError {
    if (cause instanceof BridgeError) return cause
    if (isInstanceBusyError(cause)) return instanceBusy()
    if (isConnectionUnavailable(cause)) return gameNotRunning()
    if (!this.handshaked) return instanceBusy()
    return gameNotRunning()
  }

  private handleSocketClose(closeCause?: Error): void {
    const established = this.handshaked
    const error = this.connectionError(closeCause)
    this.connectionGeneration += 1
    this.socket = undefined
    this.connected = false
    this.handshaked = false
    this.connectInfo = undefined
    this.buffer = ""
    this.bytesRead = 0
    this.socketError = undefined
    this.lastDisconnectError = error
    this.rejectAllPending(error)
    if (established) {
      process.stderr.write(`[balatro-mcp] bridge disconnected: ${error.message}\n`)
      this.onDisconnect?.()
    }
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
    if (isConnectionSevered(error)) return this.connectionError()
    return error
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

    // The 'end' workaround in attachSocketHandlers can close this socket before
    // the write callback settles. Reject so queued writes do not hang.
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const onClose = () => {
      reject(
        this.lastDisconnectError ??
          gameNotRunning("Bridge connection closed before the command was written"),
      )
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
    await promise
  }

  private createPendingRequest(id: number, timeoutMs?: number): PendingRequest {
    const { promise, resolve, reject } = Promise.withResolvers<JsonRpcResponse>()
    void promise.catch(() => undefined)
    const pending: PendingRequest = { promise, resolve, reject }
    this.pendingRequests.set(id, pending)
    // Start the request timeout before writing so a queued write cannot
    // outlive its deadline.
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

  private assertConnected(): void {
    if (!this.connected) throw this.lastDisconnectError ?? gameNotRunning()
  }
}
