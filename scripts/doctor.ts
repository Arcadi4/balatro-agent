import { stat } from "node:fs/promises";

import {
  balatroApp,
  balatroDir,
  balatroLove,
  balatroSave,
  loveBin,
  lovelyDylib,
  lovelyRun,
  modsDir,
  smodsDir,
  smodsManifest,
} from "./lib/environment.js";
import { repoPath } from "./lib/paths.js";

async function check(kind: "dir" | "file", path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    if (kind === "dir" ? info.isDirectory() : info.isFile()) {
      console.log(`ok ${kind}  ${path}`);
      return true;
    }
  } catch {
    // Reported below with the same message as a missing path.
  }
  console.error(`missing ${kind} ${path}`);
  return false;
}

console.log("Balatro mod development environment");
console.log(`BALATRO_DIR: ${balatroDir}`);
console.log(`BALATRO_APP: ${balatroApp}`);
console.log(`BALATRO_SAVE: ${balatroSave}\n`);

const checks: Array<Promise<boolean>> = [
  check("dir", balatroApp),
  check("file", loveBin),
  check("file", lovelyDylib),
  check("file", lovelyRun),
  check("file", balatroLove),
  check("dir", balatroSave),
  check("dir", modsDir),
  check("dir", smodsDir),
  check("file", smodsManifest),
  check("dir", repoPath("mod")),
];

if (!(await Promise.all(checks)).every(Boolean)) {
  process.exitCode = 1;
}
