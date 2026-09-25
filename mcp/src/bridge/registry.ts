import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import { resolveBridgeRegistryPrefix, resolveBridgeSocketPath } from "./protocol.js"

export interface BridgeInstance {
  instance_id: string
  endpoint: string
  updated_at: number
}

const INSTANCE_TTL_MS = 10_000

function parseInstanceRecord(contents: string): BridgeInstance | undefined {
  const [instanceId, endpoint, updatedAt] = contents.trim().split("\t")
  if (!instanceId || !endpoint || updatedAt === undefined) return undefined
  const timestamp = Number(updatedAt)
  if (!Number.isFinite(timestamp)) return undefined
  return { instance_id: instanceId, endpoint, updated_at: timestamp }
}

export async function discoverBridgeInstances(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<BridgeInstance[]> {
  const registryPrefix = resolveBridgeRegistryPrefix(platform, env)
  const directory = dirname(registryPrefix)
  const prefix = basename(registryPrefix)
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }

  const instances: BridgeInstance[] = []
  for (const entry of entries) {
    if (!entry.startsWith(`${prefix}-`)) continue
    try {
      const contents = await readFile(join(directory, entry), "utf8")
      const instance = parseInstanceRecord(contents)
      if (instance === undefined) continue
      if (now - instance.updated_at > INSTANCE_TTL_MS) continue
      instances.push(instance)
    } catch {
      continue
    }
  }
  return instances.sort((left, right) => left.instance_id.localeCompare(right.instance_id))
}

export function instanceEndpoint(
  instanceId: string,
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
): string {
  return resolveBridgeSocketPath(instanceId, platform, env)
}
