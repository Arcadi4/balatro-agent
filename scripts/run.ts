import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";

import { balatroDir, loveBin, lovelyDylib } from "./lib/environment.js";
import { installMods } from "./lib/install-mods.js";
import { run } from "./lib/process.js";

await installMods();

try {
  await access(loveBin, constants.X_OK);
  if (!(await stat(lovelyDylib)).isFile()) {
    throw new Error(`Lovely dylib is missing: ${lovelyDylib}`);
  }
} catch {
  throw new Error(`Balatro love executable is missing or not executable: ${loveBin}`);
}

const forwarded = process.argv.slice(2);
while (forwarded[0] === "--") {
  forwarded.shift();
}
const args = forwarded.length > 0 ? forwarded : (process.env.ARGS?.trim().split(/\s+/) ?? []);

await run(loveBin, args, {
  cwd: balatroDir,
  env: { ...process.env, DYLD_INSERT_LIBRARIES: lovelyDylib },
});
