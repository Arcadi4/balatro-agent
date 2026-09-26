import { createConnection, type Socket } from "node:net"

import {
  errorCodeToString,
  isJsonRpcResponse,
  parseFrames,
  serializeFrame,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js"
import { discoverBridgeInstances, instanceEndpoint, type BridgeInstance } from "./registry.js"

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
  seq?: number
  applied_state_seq?: number
}

export interface ConnectInfo {
  instance_id: string
  phase?: string
}

interface BridgeSession {
  instanceId: string
  socketPath: string
  socket?: Socket
  decoder: TextDecoder
  bytesRead: number
  connectionGeneration: number
  connected: boolean
  handshaked: boolean
  buffer: string
  connectInfo?: ConnectInfo
  lastDisconnectError?: BridgeError
  socketError?: Error
  pendingRequests: Map<number, PendingRequest>
  writeQueue: Promise<void>
}

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

function errnoCode(error: Error | undefined): string | undefined {
  return error === undefined ? undefined : (error as ErrnoException).code
}

function isConnectionUnavailable(error: Error | undefined): boolean {
  const code = errnoCode(error)
  return code === "ECONNREFUSED" || code === "ENOENT"
}

function isConnectionSevered(error: Error | undefined): boolean {
  const code = errnoCode(error)
  return code === "EPIPE" || code === "ECONNRESET" || code === "ECONNABORTED"
}

function gameNotRunning(message = "Balatro is not running"): BridgeError {
  return new BridgeError("GAME_NOT_RUNNING", message)
}

function instanceNotConnected(instanceId?: string): BridgeError {
  return new BridgeError(
    "INSTANCE_NOT_CONNECTED",
    instanceId === undefined
      ? "No Balatro instance is connected"
      : `Balatro instance ${instanceId} is not connected`,
    instanceId === undefined ? {} : { instance_id: instanceId },
  )
}

// The socket died mid-flight. The game may still be running, so report the lost
// bridge connection rather than claiming Balatro stopped.
function bridgeDisconnected(
  instanceId: string,
  message = "Lost the Balatro bridge connection",
): BridgeError {
  return new BridgeError("INSTANCE_NOT_CONNECTED", message, { instance_id: instanceId })
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
  private readonly sessions = new Map<string, BridgeSession>()
  private readonly connectPromises = new Map<string, Promise<ConnectInfo>>()
  private readonly pendingRequestSessions = new Map<number, BridgeSession>()
  private commandSeq = 0
  private selectionPromise?: Promise<ConnectInfo>
  private defaultInstanceId?: string
  private disposed = false
  onDisconnect?: (instanceId: string) => void

  constructor(private readonly socketPath?: string) {}

  isConnected(instanceId?: string): boolean {
    return this.sessions.get(instanceId ?? this.defaultInstanceId ?? "")?.handshaked ?? false
  }

  getSelectedInstanceId(): string | undefined {
    return this.defaultInstanceId
  }

  disconnect(instanceId?: string): string {
    const resolvedId = instanceId ?? this.defaultInstanceId
    if (resolvedId === undefined) throw instanceNotConnected(instanceId)
    const session = this.sessions.get(resolvedId)
    if (session === undefined || !session.connected) throw instanceNotConnected(resolvedId)
    this.detachSession(
      session,
      new BridgeError("INSTANCE_NOT_CONNECTED", `Disconnected Balatro instance ${resolvedId}`, {
        instance_id: resolvedId,
      }),
    )
    return resolvedId
  }

  async listInstances(): Promise<BridgeInstance[]> {
    return await discoverBridgeInstances()
  }

  async connect(instanceId?: string): Promise<ConnectInfo> {
    if (this.disposed) throw gameNotRunning("BridgeClient has been disposed")
    if (instanceId !== undefined) return await this.connectToInstance(instanceId)
    if (this.defaultInstanceId !== undefined) {
      const current = this.sessions.get(this.defaultInstanceId)
      if (current?.connectInfo !== undefined) return current.connectInfo
    }
    if (this.selectionPromise !== undefined) return await this.selectionPromise

    const promise = this.selectAndConnect()
    this.selectionPromise = promise
    try {
      return await promise
    } finally {
      if (this.selectionPromise === promise) this.selectionPromise = undefined
    }
  }

  private async selectAndConnect(): Promise<ConnectInfo> {
    const instances = await this.listInstances()
    if (instances.length === 0) throw gameNotRunning()
    if (instances.length > 1) {
      throw new BridgeError(
        "INSTANCE_SELECTION_REQUIRED",
        "Multiple Balatro instances are available; select one with instance_id",
        // Socket paths and discovery timestamps are transport internals; the
        // caller only needs the IDs it can pass to connect.
        { instances: instances.map(({ instance_id }) => ({ instance_id })) },
      )
    }
    const instance = instances[0]
    if (instance === undefined) throw gameNotRunning()
    return await this.connectToInstance(instance.instance_id)
  }

  private async connectToInstance(instanceId: string): Promise<ConnectInfo> {
    const existing = this.sessions.get(instanceId)
    if (existing?.connectInfo !== undefined) {
      this.defaultInstanceId = instanceId
      return existing.connectInfo
    }
    const pending = this.connectPromises.get(instanceId)
    if (pending !== undefined) return await pending

    const instances = await this.listInstances()
    const record = instances.find((candidate) => candidate.instance_id === instanceId)
    if (record === undefined && this.socketPath === undefined) {
      throw new BridgeError("GAME_NOT_FOUND", `Balatro instance ${instanceId} was not found`, {
        instance_id: instanceId,
      })
    }

    const session: BridgeSession = {
      instanceId,
      socketPath: record?.endpoint ?? this.socketPath ?? instanceEndpoint(instanceId),
      decoder: new TextDecoder(),
      bytesRead: 0,
      connectionGeneration: 0,
      connected: false,
      handshaked: false,
      buffer: "",
      pendingRequests: new Map(),
      writeQueue: Promise.resolve(),
    }
    this.sessions.set(instanceId, session)
    const promise = this.establish(session)
    this.connectPromises.set(instanceId, promise)
    try {
      const info = await promise
      this.defaultInstanceId = instanceId
      return info
    } catch (error) {
      this.detachFailedSession(session, error)
      throw error
    } finally {
      if (this.connectPromises.get(instanceId) === promise) this.connectPromises.delete(instanceId)
    }
  }

  async getState(): Promise<Record<string, unknown>>
  async getState(timeoutMs: number, instanceId?: string): Promise<Record<string, unknown>>
  async getState(options: { maxAgeMs?: number }, instanceId?: string): Promise<StateEnvelope>
  async getState(
    timeoutOrOptions: number | { maxAgeMs?: number } = STATE_TIMEOUT_MS,
    instanceId?: string,
  ): Promise<Record<string, unknown> | StateEnvelope> {
    const timeoutMs = typeof timeoutOrOptions === "number" ? timeoutOrOptions : STATE_TIMEOUT_MS
    const result = asRecord(await this.request("get_state", undefined, timeoutMs, instanceId))
    if (!result) throw new BridgeError("PROTOCOL_MISMATCH", "State response is not an object")
    if (typeof timeoutOrOptions === "object") {
      if (!asRecord(result.payload))
        throw new BridgeError("PROTOCOL_MISMATCH", "State response has no payload object")
      return result as unknown as StateEnvelope
    }
    const payload = asRecord(result.payload)
    if (!payload) throw new BridgeError("PROTOCOL_MISMATCH", "State response has no payload")
    return payload
  }

  async command(
    kind: string,
    args?: Record<string, unknown>,
    timeoutMs = RESPONSE_TIMEOUT_MS,
    instanceId?: string,
  ): Promise<unknown> {
    const result = asRecord(await this.request(kind, args ?? {}, timeoutMs, instanceId))
    if (!result || result.ok !== true)
      throw new BridgeError("PROTOCOL_MISMATCH", `Command ${kind} returned an invalid result`)
    return result.data
  }

  async sendCommand(options: {
    kind: string
    args?: Record<string, unknown>
    instanceId?: string
  }): Promise<number> {
    const session = this.requireSession(options.instanceId)
    const id = ++this.commandSeq
    const pending = this.createPendingRequest(session, id)
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: options.kind,
      ...(options.args === undefined ? {} : { params: options.args }),
    }
    try {
      await this.writeFrame(session, request)
      return id
    } catch (cause) {
      const error = this.normalizeRequestError(session, cause)
      this.rejectAndDeletePending(session, id, error)
      throw error
    }
  }

  async awaitResponse(
    seq: number,
    options: { timeoutMs?: number; instanceId?: string } = {},
  ): Promise<ResponseEnvelope> {
    const session =
      options.instanceId === undefined
        ? this.pendingRequestSessions.get(seq)
        : this.requireSession(options.instanceId)
    if (session === undefined || this.pendingRequestSessions.get(seq) !== session) {
      throw new BridgeError("INTERNAL_ERROR", `No pending bridge request ${seq}`)
    }
    const pending = session.pendingRequests.get(seq)
    if (!pending) throw new BridgeError("INTERNAL_ERROR", `No pending bridge request ${seq}`)
    try {
      const response = await this.awaitJsonRpcResponse(
        session,
        seq,
        pending,
        options.timeoutMs ?? RESPONSE_TIMEOUT_MS,
      )
      if (response.error)
        throw new BridgeError(bridgeErrorCode(response.error), response.error.message)
      const result = asRecord(response.result)
      if (!result || typeof result.ok !== "boolean")
        throw new BridgeError("PROTOCOL_MISMATCH", "Bridge command returned an invalid result")
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
      throw this.normalizeRequestError(session, cause)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const session of this.sessions.values()) {
      this.rejectAllPending(session, gameNotRunning())
      session.connected = false
      session.handshaked = false
      session.connectInfo = undefined
      session.buffer = ""
      session.bytesRead = 0
      session.connectionGeneration += 1
      session.socket?.destroy()
      session.socket = undefined
    }
    this.sessions.clear()
    this.defaultInstanceId = undefined
  }

  private detachSession(session: BridgeSession, error: BridgeError): void {
    const established = session.handshaked
    const socket = session.socket
    session.connectionGeneration += 1
    session.socket = undefined
    session.connected = false
    session.handshaked = false
    session.connectInfo = undefined
    session.buffer = ""
    session.bytesRead = 0
    session.socketError = undefined
    session.lastDisconnectError = error
    this.rejectAllPending(session, error)
    if (this.sessions.get(session.instanceId) === session) this.sessions.delete(session.instanceId)
    if (this.defaultInstanceId === session.instanceId) this.defaultInstanceId = undefined
    socket?.destroy()
    if (established) {
      process.stderr.write(
        `[balatro-mcp] bridge ${session.instanceId} disconnected: ${error.message}\n`,
      )
      this.onDisconnect?.(session.instanceId)
    }
  }

  private detachFailedSession(session: BridgeSession, cause: unknown): void {
    const error = cause instanceof BridgeError ? cause : gameNotRunning()
    this.detachSession(session, error)
  }

  private async establish(session: BridgeSession): Promise<ConnectInfo> {
    await this.dial(session)
    let data: Record<string, unknown> | undefined
    try {
      data = asRecord(
        await this.request("connect", undefined, HANDSHAKE_TIMEOUT_MS, session.instanceId),
      )
    } catch (cause) {
      if (cause instanceof BridgeError && cause.code === "UNKNOWN_METHOD") {
        throw new BridgeError(
          "PROTOCOL_MISMATCH",
          "Bridge mod does not support the connect handshake; update the Balatro mod",
        )
      }
      throw cause
    }
    session.handshaked = true
    session.connectInfo = {
      instance_id: session.instanceId,
      ...(typeof data?.phase === "string" ? { phase: data.phase } : {}),
    }
    return session.connectInfo
  }

  private dial(session: BridgeSession): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    session.decoder = new TextDecoder()
    const socket = createConnection(session.socketPath)
    session.socket = socket
    this.attachSocketHandlers(session, socket)
    const onConnect = (): void => {
      socket.off("close", onClose)
      resolve()
    }
    const onClose = (): void => {
      socket.off("connect", onConnect)
      reject(
        this.disposed
          ? gameNotRunning()
          : (session.lastDisconnectError ?? this.connectionError(session)),
      )
    }
    socket.once("connect", onConnect)
    socket.once("close", onClose)
    return promise
  }

  private attachSocketHandlers(session: BridgeSession, socket: Socket): void {
    socket.once("connect", () => {
      if (this.disposed || session.socket !== socket) {
        socket.destroy()
        return
      }
      session.connectionGeneration += 1
      session.connected = true
      session.lastDisconnectError = undefined
    })
    socket.on("data", (data) => {
      if (session.socket !== socket) return
      if (typeof data === "string") {
        session.bytesRead += data.length
        this.handleData(session, data)
        return
      }
      session.bytesRead += data.byteLength
      this.handleData(session, session.decoder.decode(data, { stream: true }))
    })
    socket.on("error", (error) => {
      if (session.socket === socket) session.socketError = error
    })
    socket.on("end", () => {
      if (session.socket === socket) socket.destroy()
    })
    socket.once("close", () => {
      if (session.socket === socket) this.handleSocketClose(session, session.socketError)
    })
  }

  private connectionError(session: BridgeSession, cause?: Error): BridgeError {
    if (cause instanceof BridgeError) return cause
    if (errnoCode(cause) === "EBUSY")
      return new BridgeError("INSTANCE_BUSY", "Balatro bridge is busy or held by another client")
    return gameNotRunning()
  }

  private handleSocketClose(session: BridgeSession, closeCause?: Error): void {
    this.detachSession(session, this.connectionError(session, closeCause))
  }

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    instanceId?: string,
  ): Promise<unknown> {
    const session = this.requireSession(instanceId)
    const id = ++this.commandSeq
    const pending = this.createPendingRequest(session, id, timeoutMs)
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }
    try {
      await this.writeFrame(session, request)
      const response = await this.awaitJsonRpcResponse(session, id, pending)
      if (response.error)
        throw new BridgeError(bridgeErrorCode(response.error), response.error.message)
      return response.result
    } catch (cause) {
      const error = this.normalizeRequestError(session, cause)
      this.rejectAndDeletePending(session, id, error)
      throw error
    }
  }

  private normalizeRequestError(session: BridgeSession, cause: unknown): Error {
    const error = toError(cause)
    if (error instanceof BridgeError) return error
    if (isConnectionUnavailable(error)) return gameNotRunning()
    if (isConnectionSevered(error)) return this.connectionError(session)
    return error
  }

  private handleData(session: BridgeSession, chunk: string): void {
    const parsed = parseFrames(session.buffer + chunk)
    session.buffer = parsed.remainder
    for (const message of parsed.messages) {
      if (isJsonRpcResponse(message)) session.pendingRequests.get(message.id)?.resolve(message)
    }
  }

  private writeFrame(session: BridgeSession, request: JsonRpcRequest): Promise<void> {
    const generation = session.connectionGeneration
    const write = session.writeQueue.then(() => this.writeFrameNow(session, request, generation))
    session.writeQueue = write.catch(() => undefined)
    return write
  }

  private async writeFrameNow(
    session: BridgeSession,
    request: JsonRpcRequest,
    generation: number,
  ): Promise<void> {
    const socket = session.socket
    if (
      !session.connected ||
      !socket ||
      session.socket !== socket ||
      session.connectionGeneration !== generation ||
      socket.destroyed ||
      !socket.writable
    ) {
      throw session.lastDisconnectError ?? bridgeDisconnected(session.instanceId)
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const onClose = () =>
      reject(
        session.lastDisconnectError ??
          bridgeDisconnected(session.instanceId, "Bridge connection closed before the write"),
      )
    socket.once("close", onClose)
    socket.write(serializeFrame(request), (error) => {
      socket.removeListener("close", onClose)
      if (error) reject(error)
      else if (session.socket !== socket || session.connectionGeneration !== generation)
        reject(bridgeDisconnected(session.instanceId, "Bridge connection changed mid-write"))
      else resolve()
    })
    await promise
  }

  private createPendingRequest(
    session: BridgeSession,
    id: number,
    timeoutMs?: number,
  ): PendingRequest {
    const { promise, resolve, reject } = Promise.withResolvers<JsonRpcResponse>()
    void promise.catch(() => undefined)
    const pending: PendingRequest = { promise, resolve, reject }
    session.pendingRequests.set(id, pending)
    this.pendingRequestSessions.set(id, session)
    if (timeoutMs !== undefined) {
      pending.timeout = setTimeout(() => {
        session.pendingRequests.delete(id)
        this.pendingRequestSessions.delete(id)
        pending.reject(new BridgeError("BRIDGE_TIMEOUT", "No bridge response before the timeout"))
      }, timeoutMs)
    }
    return pending
  }

  private async awaitJsonRpcResponse(
    session: BridgeSession,
    id: number,
    pending: PendingRequest,
    timeoutMs?: number,
  ): Promise<JsonRpcResponse> {
    if (timeoutMs !== undefined) {
      pending.timeout = setTimeout(() => {
        session.pendingRequests.delete(id)
        this.pendingRequestSessions.delete(id)
        pending.reject(new BridgeError("BRIDGE_TIMEOUT", "No bridge response before the timeout"))
      }, timeoutMs)
    }
    try {
      return await pending.promise
    } finally {
      clearTimeout(pending.timeout)
      session.pendingRequests.delete(id)
      this.pendingRequestSessions.delete(id)
    }
  }

  private rejectAndDeletePending(session: BridgeSession, id: number, error: Error): void {
    const pending = session.pendingRequests.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    pending.reject(error)
    session.pendingRequests.delete(id)
    if (this.pendingRequestSessions.get(id) === session) this.pendingRequestSessions.delete(id)
  }

  private rejectAllPending(session: BridgeSession, error: Error): void {
    for (const [id, pending] of session.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      if (this.pendingRequestSessions.get(id) === session) this.pendingRequestSessions.delete(id)
    }
    session.pendingRequests.clear()
  }

  private requireSession(instanceId?: string): BridgeSession {
    const resolvedId = instanceId ?? this.defaultInstanceId
    if (resolvedId === undefined) throw instanceNotConnected(instanceId)
    const session = this.sessions.get(resolvedId)
    if (session === undefined || !session.connected) throw instanceNotConnected(resolvedId)
    return session
  }
}
