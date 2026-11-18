import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function repoPath(...parts: string[]): string {
  return join(repoRoot, ...parts);
}
