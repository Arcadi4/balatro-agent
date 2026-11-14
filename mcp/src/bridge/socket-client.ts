import { createConnection, type Socket } from "node:net"

import {
  errorCodeToString,
  isJsonRpcResponse,
  parseFrames,
  serializeFrame,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.js"
import { discoverBridgeInstances, type BridgeInstance } from "./registry.js"

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

export interface ResolvedInstance {
  instance_index: number
  instance: BridgeInstance
}

// One socket and its framing state. Handlers compare this identity so a stale
// connection cannot feed data or errors into a newer session.
interface BridgeConnection {
  readonly socket: Socket
  readonly decoder: TextDecoder
  buffer: string
  socketError?: Error
}

interface EstablishingSession {
  readonly connection: BridgeConnection
  readonly establishment: Promise<ConnectInfo>
}

// A session owns exactly one connection: dialing, then handshaking, then ready.
// Closed is terminal for the session object, so a late socket event or handshake
// continuation finds a state that no longer matches and cannot revive it.
type SessionState =
  | ({ readonly phase: "dialing" } & EstablishingSession)
  | ({ readonly phase: "handshaking" } & EstablishingSession)
  | {
      readonly phase: "ready"
      readonly connection: BridgeConnection
      readonly connectInfo: ConnectInfo
    }
  | { readonly phase: "closed"; readonly error: BridgeError }

interface BridgeSession {
  readonly instanceId: string
  state: SessionState
  // The pending map stays session-owned until the request lifecycle is split out.
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

// The socket died mid-flight. The game may still be running, so report the lost
// bridge connection rather than claiming Balatro stopped.
function bridgeDisconnected(message = "Lost the Balatro bridge connection"): BridgeError {
  return new BridgeError("INSTANCE_NOT_CONNECTED", message)
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
  private readonly pendingRequestSessions = new Map<number, BridgeSession>()
  private commandSeq = 0
  private disposed = false

  isConnected(instanceId: string): boolean {
    return this.sessions.get(instanceId)?.state.phase === "ready"
  }

  disconnect(instanceId: string): void {
    const session = this.sessions.get(instanceId)
    if (session === undefined) {
      throw new BridgeError("INSTANCE_NOT_CONNECTED", "The Balatro instance is not connected")
    }
    // Closes a dial or handshake in flight too, so a later response or connect
    // event cannot bring the session back.
    this.closeSession(
      session,
      new BridgeError("INSTANCE_NOT_CONNECTED", "Disconnected from Balatro"),
    )
  }

  async listInstances(): Promise<BridgeInstance[]> {
    return await discoverBridgeInstances()
  }

  async resolveInstance(instanceIndex?: number): Promise<ResolvedInstance> {
    const instances = await this.listInstances()
    if (instances.length === 0) throw gameNotRunning()
    const available = instances.map((instance, index) => ({
      instance_index: index,
      connected: this.isConnected(instance.instance_id),
    }))
    if (instanceIndex === undefined && instances.length > 1) {
      throw new BridgeError(
        "INSTANCE_SELECTION_REQUIRED",
        `Multiple Balatro instances are available: ${available.map(({ instance_index }) => instance_index).join(", ")}. Retry with instance_index, or read balatro://instances for details.`,
        { instances: available },
      )
    }
    const index = instanceIndex ?? 0
    const instance = instances[index]
    if (instance === undefined) {
      throw new BridgeError(
        "GAME_NOT_FOUND",
        `No Balatro instance exists at index ${index}. Read balatro://instances for the current indices.`,
        { instance_index: index, instances: available },
      )
    }
    return { instance_index: index, instance }
  }

  async connect(instance: BridgeInstance): Promise<ConnectInfo> {
    if (this.disposed) throw gameNotRunning("BridgeClient has been disposed")
    const existing = this.sessions.get(instance.instance_id)
    if (existing !== undefined) {
      const state = existing.state
      if (state.phase === "ready") return state.connectInfo
      // Concurrent callers share the one establishment for this session.
      if (state.phase === "dialing" || state.phase === "handshaking")
        return await state.establishment
    }
    return await this.openSession(instance)
  }

  async getState(timeoutMs: number, instanceId: string): Promise<Record<string, unknown>>
  async getState(options: { maxAgeMs?: number }, instanceId: string): Promise<StateEnvelope>
  async getState(
    timeoutOrOptions: number | { maxAgeMs?: number },
    instanceId: string,
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
    args: Record<string, unknown> | undefined,
    instanceId: string,
  ): Promise<unknown> {
    // Game commands complete when the game completes them; a response deadline
    // here can only truncate a legitimate long-running action. Dead bridges
    // reject pending requests when the socket closes.
    const result = asRecord(await this.request(kind, args ?? {}, undefined, instanceId))
    if (!result || result.ok !== true)
      throw new BridgeError("PROTOCOL_MISMATCH", `Command ${kind} returned an invalid result`)
    return result.data
  }

  async sendCommand(options: {
    kind: string
    args?: Record<string, unknown>
    instanceId: string
  }): Promise<number> {
    const session = this.requireReady(options.instanceId)
    const id = ++this.commandSeq
    // Registers the slot that awaitResponse resolves later; the handle itself is unused here.
    this.createPendingRequest(session, id)
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
        : this.requireReady(options.instanceId)
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
    for (const session of [...this.sessions.values()]) {
      this.closeSession(session, gameNotRunning())
    }
    this.sessions.clear()
  }

  private closeSession(session: BridgeSession, error: BridgeError): void {
    const state = session.state
    if (state.phase === "closed") return
    session.state = { phase: "closed", error }
    this.rejectAllPending(session, error)
    if (this.sessions.get(session.instanceId) === session) this.sessions.delete(session.instanceId)
    state.connection.socket.destroy()
    if (!this.disposed && state.phase === "ready") {
      process.stderr.write(
        `[balatro-mcp] bridge ${session.instanceId} disconnected: ${error.message}\n`,
      )
    }
  }

  private openSession(instance: BridgeInstance): Promise<ConnectInfo> {
    const { promise: establishment, resolve, reject } = Promise.withResolvers<ConnectInfo>()
    let socket: Socket
    try {
      socket = createConnection(instance.endpoint)
    } catch (cause) {
      return Promise.reject(cause instanceof BridgeError ? cause : gameNotRunning())
    }
    const connection: BridgeConnection = {
      socket,
      decoder: new TextDecoder(),
      buffer: "",
    }
    const session: BridgeSession = {
      instanceId: instance.instance_id,
      state: { phase: "dialing", connection, establishment },
      pendingRequests: new Map(),
      writeQueue: Promise.resolve(),
    }
    this.sessions.set(session.instanceId, session)
    this.attachSocketHandlers(session, connection)
    void this.establish(session, connection, establishment).then(resolve, (cause: unknown) => {
      const error = cause instanceof BridgeError ? cause : gameNotRunning()
      this.closeSession(session, error)
      reject(error)
    })
    return establishment
  }

  // Post-await continuations read through this getter: an asynchronous close can
  // land while a callback is paused, so a fresh function return re-exposes the
  // whole union instead of the state narrowed at the assignment site.
  private readSessionState(session: BridgeSession): SessionState {
    return session.state
  }

  private async establish(
    session: BridgeSession,
    connection: BridgeConnection,
    establishment: Promise<ConnectInfo>,
  ): Promise<ConnectInfo> {
    await this.dial(session, connection)
    const dialed = session.state
    if (dialed.phase !== "dialing" || dialed.connection !== connection) {
      throw dialed.phase === "closed" ? dialed.error : bridgeDisconnected()
    }
    session.state = { phase: "handshaking", connection, establishment }
    let data: Record<string, unknown> | undefined
    try {
      data = asRecord(
        await this.requestOnSession(session, "connect", undefined, HANDSHAKE_TIMEOUT_MS),
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
    // A close can land after the handshake response but before this continuation;
    // ready is only reachable while this exact connection is still handshaking,
    // so this fresh read decides whether the session survived the handshake.
    const handshaking = this.readSessionState(session)
    if (handshaking.phase !== "handshaking" || handshaking.connection !== connection) {
      throw handshaking.phase === "closed" ? handshaking.error : bridgeDisconnected()
    }
    const connectInfo: ConnectInfo = {
      instance_id: session.instanceId,
      ...(typeof data?.phase === "string" ? { phase: data.phase } : {}),
    }
    session.state = { phase: "ready", connection, connectInfo }
    return connectInfo
  }

  private dial(session: BridgeSession, connection: BridgeConnection): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const socket = connection.socket
    const onConnect = (): void => {
      socket.off("close", onClose)
      resolve()
    }
    const onClose = (): void => {
      socket.off("connect", onConnect)
      const state = session.state
      reject(state.phase === "closed" ? state.error : this.connectionError(connection))
    }
    socket.once("connect", onConnect)
    socket.once("close", onClose)
    return promise
  }

  private attachSocketHandlers(session: BridgeSession, connection: BridgeConnection): void {
    const socket = connection.socket
    socket.on("data", (data) => {
      if (!this.isActiveConnection(session, connection)) return
      this.handleData(
        session,
        connection,
        typeof data === "string" ? data : connection.decoder.decode(data, { stream: true }),
      )
    })
    socket.on("error", (error) => {
      connection.socketError = error
    })
    socket.on("end", () => {
      if (this.isActiveConnection(session, connection)) socket.destroy()
    })
    socket.once("close", () => {
      if (this.isActiveConnection(session, connection))
        this.closeSession(session, this.connectionError(connection))
    })
  }

  private isActiveConnection(session: BridgeSession, connection: BridgeConnection): boolean {
    const state = session.state
    return state.phase !== "closed" && state.connection === connection
  }

  private connectionError(connection: BridgeConnection): BridgeError {
    if (errnoCode(connection.socketError) === "EBUSY")
      return new BridgeError("INSTANCE_BUSY", "Balatro bridge is busy or held by another client")
    return gameNotRunning()
  }

  private async request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number | undefined,
    instanceId: string,
  ): Promise<unknown> {
    return await this.requestOnSession(this.requireReady(instanceId), method, params, timeoutMs)
  }

  // The connect handshake runs while its session is still handshaking, so the
  // request path takes the session directly instead of looking one up as ready.
  private async requestOnSession(
    session: BridgeSession,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number | undefined,
  ): Promise<unknown> {
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
    if (isConnectionSevered(error)) {
      const state = session.state
      return state.phase === "closed" ? state.error : gameNotRunning()
    }
    return error
  }

  private handleData(session: BridgeSession, connection: BridgeConnection, chunk: string): void {
    const parsed = parseFrames(connection.buffer + chunk)
    connection.buffer = parsed.remainder
    for (const message of parsed.messages) {
      if (isJsonRpcResponse(message)) session.pendingRequests.get(message.id)?.resolve(message)
    }
  }

  private writeFrame(session: BridgeSession, request: JsonRpcRequest): Promise<void> {
    const write = session.writeQueue.then(() => this.writeFrameNow(session, request))
    session.writeQueue = write.catch(() => undefined)
    return write
  }

  private async writeFrameNow(session: BridgeSession, request: JsonRpcRequest): Promise<void> {
    const state = session.state
    if (state.phase === "closed") throw state.error
    if (state.phase === "dialing") throw bridgeDisconnected()
    const connection = state.connection
    const socket = connection.socket
    if (socket.destroyed || !socket.writable) throw bridgeDisconnected()
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const connectionGone = (fallback: BridgeError): BridgeError => {
      const current = session.state
      return current.phase === "closed" ? current.error : fallback
    }
    const onClose = () =>
      reject(connectionGone(bridgeDisconnected("Bridge connection closed before the write")))
    socket.once("close", onClose)
    socket.write(serializeFrame(request), (error) => {
      socket.removeListener("close", onClose)
      if (error) reject(error)
      else if (!this.isActiveConnection(session, connection))
        reject(connectionGone(bridgeDisconnected("Bridge connection changed mid-write")))
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

  private requireReady(instanceId: string): BridgeSession {
    const session = this.sessions.get(instanceId)
    if (session === undefined || session.state.phase !== "ready") {
      throw new BridgeError("INSTANCE_NOT_CONNECTED", "The Balatro instance is not connected")
    }
    return session
  }
}
