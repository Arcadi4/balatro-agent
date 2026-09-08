import { join } from "node:path"

import metadata from "../package.json"
import { targets } from "./platforms.js"

const registry = "https://registry.npmjs.org"
const root = join(import.meta.dir, "..")
const nativeNpm = Bun.which("npm")
const repository = new URL(metadata.repository.url.replace(/^git\+/, "")).pathname
  .slice(1)
  .replace(/\.git$/, "")

async function npm(args: string[], cwd = root): Promise<void> {
  const command = nativeNpm === null ? [process.execPath, "x", "--bun", "npm@11.19.0"] : [nativeNpm]
  const child = Bun.spawn([...command, ...args, `--registry=${registry}`], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await child.exited) !== 0)
    throw new Error(`npm ${args[0]} failed; fix the reported error and rerun release:setup`)
}

console.log(
  "This creates the @balatro-mcp binary packages and authorizes release.yml to publish them.",
)
console.log(
  "Bootstrap publishes may request a publish OTP. During npm trust setup, select the option to skip further 2FA for five minutes.",
)
await npm(["login"])

for (const { os, cpu } of targets) {
  const name = `@balatro-mcp/${os}-${cpu}`
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    const dir = join(root, "dist", "bootstrap", `${os}-${cpu}`)
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name,
          version: "0.0.0",
          description:
            "Reserved for balatro-mcp native releases; install balatro-mcp to use the server.",
          license: metadata.license,
          repository: metadata.repository,
        },
        null,
        2,
      ),
      { createPath: true },
    )
    await Bun.write(join(dir, "LICENSE"), Bun.file(join(root, "LICENSE")))
    await npm(["publish", "--access=public", "--tag=bootstrap", "--ignore-scripts"], dir)
  } else if (!response.ok) {
    throw new Error(`Cannot inspect ${name}: HTTP ${response.status}`)
  }

  await npm([
    "trust",
    "github",
    name,
    "--repo",
    repository,
    "--file",
    "release.yml",
    "--allow-publish",
    "--yes",
  ])
  await Bun.sleep(2_000)
}
console.log(
  "Setup complete. Push a version tag; release.yml publishes binaries and stages only balatro-mcp for approval.",
)
