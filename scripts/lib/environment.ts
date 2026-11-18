import { homedir } from "node:os";
import { join } from "node:path";

// The defaults match the macOS development setup; non-macOS setups pass
// BALATRO_DIR and BALATRO_SAVE explicitly.
export const balatroDir =
  process.env.BALATRO_DIR ??
  join(homedir(), "Library/Application Support/Steam/steamapps/common/Balatro");
export const balatroSave =
  process.env.BALATRO_SAVE ?? join(homedir(), "Library/Application Support/Balatro");

export const balatroApp = join(balatroDir, "Balatro.app");
export const loveBin = join(balatroApp, "Contents/MacOS/love");
export const lovelyDylib = join(balatroDir, "liblovely.dylib");
export const lovelyRun = join(balatroDir, "run_lovely_macos.sh");
export const balatroLove = join(balatroApp, "Contents/Resources/Balatro.love");
export const modsDir = join(balatroSave, "Mods");
export const modDst = join(modsDir, "balatro-agent");
export const smodsDir = join(modsDir, "smods");
export const smodsManifest = join(smodsDir, "manifest.json");
