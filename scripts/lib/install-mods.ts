import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { modDst } from "./environment.js";
import { repoPath } from "./paths.js";

export async function installMods(): Promise<void> {
  const source = repoPath("mod");
  try {
    if (!(await stat(source)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new Error(`No repo mod directory found: ${source}`);
  }

  await mkdir(modDst, { recursive: true });

  // Remove files from older layouts and anything deleted from the repo since
  // the last install, but keep the runtime-owned bridge directory.
  for (const legacy of ["actions.lua", "commands.lua", "state.lua"]) {
    await rm(join(modDst, legacy), { force: true });
  }
  for (const entry of await readdir(modDst, { withFileTypes: true })) {
    if (entry.name !== "bridge") {
      await rm(join(modDst, entry.name), { recursive: true, force: true });
    }
  }

  await cp(source, modDst, { recursive: true });
  console.log(`Installed mod -> ${modDst}`);
}
