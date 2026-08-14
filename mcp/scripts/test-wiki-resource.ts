// In-process MCP server test: spawn the server over stdio, exercise resource
// protocol calls, assert on the wiki pipeline output.
import { readFileSync } from "node:fs"

type JsonRpcResponse = {
  id?: number
  result?: unknown
  error?: { message?: string }
}

const serverPath = new URL("../src/index.ts", import.meta.url).pathname
const proc = Bun.spawn(["bun", "run", serverPath], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "inherit",
})

let nextId = 1
const pending = new Map<number, Promise.withResolvers<JsonRpcResponse>>()
const decoder = new TextDecoder()

async function readLoop(): Promise<void> {
  let buf = ""
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk)
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("{")) continue
      const msg = JSON.parse(line) as JsonRpcResponse
      if (typeof msg.id === "number") pending.get(msg.id)?.resolve(msg)
    }
  }
}
void readLoop()

function request(method: string, params: unknown): Promise<JsonRpcResponse> {
  const id = nextId++
  const resolvers = Promise.withResolvers<JsonRpcResponse>()
  pending.set(id, resolvers)
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
  return resolvers.promise
}

async function requestText(method: string, params: unknown): Promise<string> {
  const res = await request(method, params)
  if (res.error) throw new Error(res.error.message ?? "rpc error")
  return JSON.stringify(res.result)
}

await request("initialize", {
  protocolVersion: "2026-07-28",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
})
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

const resources = await requestText("resources/list", {})
console.log("resources:", resources)

const templates = await requestText("resources/templates/list", {})
console.log("templates:", templates)

function readContentText(raw: string): string {
  const parsed = JSON.parse(raw) as { contents?: Array<{ text?: string }> }
  return parsed.contents?.[0]?.text ?? ""
}

const idx = await request("resources/read", { uri: "balatro://wiki/index" })
const idxText = idx.result === undefined ? "" : readContentText(JSON.stringify(idx.result))
console.log("index mentions Card_modifiers:", idxText.includes("Card_modifiers"))

const page = await request("resources/read", { uri: "balatro://wiki/Blueprint" })
const pageText = page.result === undefined ? "" : readContentText(JSON.stringify(page.result))
console.log("page title ok:", pageText.startsWith("# Blueprint"))
console.log("infobox has Buy Price:", pageText.includes("**Buy Price:** 10"))
console.log("no empty links:", !pageText.includes("[]("))
console.log("no relative links:", !pageText.includes("](/w/"))
const cm = await request("resources/read", { uri: "balatro://wiki/Card_modifiers" })
const cmText = cm.result === undefined ? "" : readContentText(JSON.stringify(cm.result))
console.log("glass card intact:", cmText.includes("when scored<br>1 in 4 chance to destroy"))

const bad = await request("resources/read", {
  uri: "balatro://wiki/This_Page_Does_Not_Exist_12345",
})
console.log("missing page:", JSON.stringify(bad.error ?? "NO ERROR"))

proc.kill()
process.exit(0)
