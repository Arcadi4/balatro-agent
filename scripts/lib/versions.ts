import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { repoRoot } from "./paths.js";

export const versionFiles = [
  { label: "mod", path: join(repoRoot, "mod/manifest.json"), relative: "mod/manifest.json" },
  { label: "mcp", path: join(repoRoot, "mcp/package.json"), relative: "mcp/package.json" },
] as const;

export async function readVersion(path: string): Promise<string> {
  const data: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof data !== "object" || data === null || !("version" in data)) {
    throw new Error(`no version in ${path}`);
  }
  const version = data.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid version in ${path}`);
  }
  return version;
}

export async function writeVersion(path: string, version: string): Promise<void> {
  const text = await readFile(path, "utf8");
  const next = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
  if (next === text) {
    throw new Error(`no version field in ${path}`);
  }
  await writeFile(path, next);
}
