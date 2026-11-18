import { relative, sep } from "node:path";

import { repoRoot } from "./lib/paths.js";
import { run, tryRun } from "./lib/process.js";
import { readVersion, versionFiles, writeVersion } from "./lib/versions.js";

const level = process.argv[2] ?? process.env.VERSION ?? "patch";
if (level !== "major" && level !== "minor" && level !== "patch") {
  throw new Error("usage: bun run bump [major|minor|patch]");
}

const branch = await run("git", ["branch", "--show-current"], { capture: true });
if (branch !== "main") {
  throw new Error(`bump: versions are cut from main, not ${branch}`);
}
if (await run("git", ["status", "--porcelain"], { capture: true })) {
  throw new Error("bump: workspace has uncommitted changes");
}

const versions = await Promise.all(versionFiles.map((file) => readVersion(file.path)));
if (versions.some((version) => version !== versions[0])) {
  const summary = versionFiles.map((file, index) => `${file.label}=${versions[index]}`).join(" ");
  throw new Error(`bump: versions are out of sync: ${summary}`);
}
const current = versions[0];
if (current === undefined) {
  throw new Error("bump: no version files");
}

const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number);
const next =
  level === "major"
    ? `${major + 1}.0.0`
    : level === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

if (
  (await tryRun("git", ["rev-parse", "-q", "--verify", `refs/tags/v${next}`], {
    capture: true,
  })) !== undefined
) {
  throw new Error(`bump: tag v${next} already exists`);
}

for (const file of versionFiles) {
  await writeVersion(file.path, next);
}

const changed = (await run("git", ["diff", "--name-only"], { capture: true }))
  .split("\n")
  .filter(Boolean)
  .sort();
const expected = versionFiles
  .map((file) => relative(repoRoot, file.path).split(sep).join("/"))
  .sort();
if (JSON.stringify(changed) !== JSON.stringify(expected)) {
  throw new Error(
    `bump: refusing to commit changes beyond the version bump: ${changed.join(", ")}`,
  );
}

await run("git", ["add", ...expected]);
await run("git", ["commit", "-m", `chore: bump to v${next}`]);
await run("git", ["tag", "-a", `v${next}`, "-m", `v${next}`]);
console.log(`bumped ${current} to ${next}, committed and tagged v${next}`);
console.log(`publish with: git push origin main v${next}`);
