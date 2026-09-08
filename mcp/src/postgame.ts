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

async function existingIndices(dir: string): Promise<number[]> {
  const indices: number[] = []
  try {
    for await (const name of new Bun.Glob("*.md").scan({ cwd: dir, onlyFiles: true })) {
      const match = FILENAME_PATTERN.exec(name)
      if (!match) continue
      const index = Number.parseInt(match[1] ?? "", 10)
      if (Number.isInteger(index)) indices.push(index)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return indices.sort((a, b) => a - b)
}

function renderDocument(title: string, summary: string, content: string): string {
  const frontmatter = Bun.YAML.stringify({ title, summary }, null, 2).trimEnd()
  return `---\n${frontmatter}\n---\n\n${content.trimEnd()}\n`
}

function parseFrontmatter(text: string): Partial<PostgameEntry> | undefined {
  const match = FRONTMATTER_PATTERN.exec(text)
  if (!match?.[1]) return undefined
  const fields: unknown = Bun.YAML.parse(match[1])
  if (typeof fields !== "object" || fields === null) return undefined
  return {
    title: "title" in fields && typeof fields.title === "string" ? fields.title : "",
    summary: "summary" in fields && typeof fields.summary === "string" ? fields.summary : "",
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
  const dir = postgameDir()
  const indices = await existingIndices(dir)
  const index = indices.reduce((max, current) => Math.max(max, current), 0) + 1
  const filepath = path.join(dir, `${index}.md`)
  await Bun.write(filepath, renderDocument(input.title, input.summary, input.content), {
    createPath: true,
  })
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
      const text = await Bun.file(path.join(dir, `${index}.md`)).text()
      const fields = parseFrontmatter(text)
      if (!fields) continue
      entries.push({
        index,
        title: fields.title ?? "",
        summary: fields.summary ?? "",
      })
    } catch {
      // Skip unreadable files and malformed frontmatter.
    }
  }
  return { dir, entries }
}

/** Returns the raw document text, or null when no analysis exists at that index. */
export async function readPostgame(index: number): Promise<string | null> {
  try {
    return await Bun.file(path.join(postgameDir(), `${index}.md`)).text()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
