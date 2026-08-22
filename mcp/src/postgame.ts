import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const POSTGAME_URI_SCHEME = "postgame://"

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const FILENAME_PATTERN = /^(\d+)\.md$/

export interface PostgameRef {
  index: number
  uri: string
  filepath: string
}

export interface PostgameEntry {
  index: number
  title: string
  summary: string
}

export interface PostgameListing {
  dir: string
  entries: PostgameEntry[]
}

/**
 * Data home mirroring ~/.local/share semantics: $XDG_DATA_HOME on Unix,
 * %LOCALAPPDATA% on Windows.
 */
function dataHome(): string {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
  }
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
}

export function postgameDir(): string {
  return path.join(dataHome(), "balatro-mcp", "postgame")
}

async function ensureDir(): Promise<string> {
  const dir = postgameDir()
  await mkdir(dir, { recursive: true })
  return dir
}

async function existingIndices(dir: string): Promise<number[]> {
  const names = await readdir(dir)
  const indices: number[] = []
  for (const name of names) {
    const match = FILENAME_PATTERN.exec(name)
    if (!match) continue
    const index = Number.parseInt(match[1] ?? "", 10)
    if (Number.isInteger(index)) indices.push(index)
  }
  return indices.sort((a, b) => a - b)
}

function yamlScalar(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`
}

function yamlUnscalar(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"') || trimmed.length < 2) return trimmed
  return trimmed
    .slice(1, -1)
    .replaceAll("\\n", "\n")
    .replace(/\\(.)/g, (_, char: string) => char)
}

function renderDocument(title: string, summary: string, content: string): string {
  const body = `${content.trimEnd()}\n`
  return `---\ntitle: ${yamlScalar(title)}\nsummary: ${yamlScalar(summary)}\n---\n\n${body}`
}

function parseFrontmatter(text: string): Partial<PostgameEntry> | undefined {
  const match = FRONTMATTER_PATTERN.exec(text)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    fields[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return {
    title: yamlUnscalar(fields.title ?? ""),
    summary: yamlUnscalar(fields.summary ?? ""),
  }
}

// Tool calls on one connection can execute concurrently; serializing keeps
// index allocation gap-free under overlapping requests.
let createQueue: Promise<unknown> = Promise.resolve()

export function createPostgame(input: {
  title: string
  summary: string
  content: string
}): Promise<PostgameRef> {
  const task = createQueue.then(() => writeNextPostgame(input))
  createQueue = task.catch(() => undefined)
  return task
}

async function writeNextPostgame(input: {
  title: string
  summary: string
  content: string
}): Promise<PostgameRef> {
  const dir = await ensureDir()
  const indices = await existingIndices(dir)
  const index = indices.reduce((max, current) => Math.max(max, current), 0) + 1
  const filepath = path.join(dir, `${index}.md`)
  await writeFile(filepath, renderDocument(input.title, input.summary, input.content), "utf8")
  return { index, uri: `${POSTGAME_URI_SCHEME}${index}`, filepath }
}

export async function listPostgames(): Promise<PostgameListing> {
  const dir = postgameDir()
  let indices: number[] = []
  try {
    indices = await existingIndices(dir)
  } catch {
    return { dir, entries: [] }
  }
  const entries: PostgameEntry[] = []
  for (const index of indices) {
    try {
      const text = await readFile(path.join(dir, `${index}.md`), "utf8")
      const fields = parseFrontmatter(text)
      if (!fields) continue
      entries.push({
        index,
        title: fields.title ?? "",
        summary: fields.summary ?? "",
      })
    } catch {
      // File vanished between listing and reading; skip it.
    }
  }
  return { dir, entries }
}

/** Returns the raw document text, or null when no analysis exists at that index. */
export async function readPostgame(index: number): Promise<string | null> {
  try {
    return await readFile(path.join(postgameDir(), `${index}.md`), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
