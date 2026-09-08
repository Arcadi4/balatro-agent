import { chmod, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import metadata from "../package.json"
import { targets } from "./platforms.js"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const release = Bun.argv.includes("--release")
const executable = process.platform === "win32" ? "balatro-mcp.exe" : "balatro-mcp"

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
process.chdir(dist)

if (!release) {
  await Bun.build({
    entrypoints: [join(root, "src/index.ts")],
    compile: { outfile: join(dist, executable) },
    minify: true,
    sourcemap: "linked",
  })
} else {
  const optionalDependencies: Record<string, string> = {}
  for (const { os, cpu, target } of targets) {
    const name = `@balatro-mcp/${os}-${cpu}`
    const dir = join(dist, "npm", `${os}-${cpu}`)
    const binary = os === "win32" ? "balatro-mcp.exe" : "balatro-mcp"
    await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      compile: { target, outfile: join(dir, "bin", binary) },
      minify: true,
      sourcemap: "linked",
    })
    await chmod(join(dir, "bin", binary), 0o755)
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name,
          version: metadata.version,
          description: `${metadata.description} (${os} ${cpu})`,
          license: metadata.license,
          repository: metadata.repository,
          os: [os],
          cpu: [cpu],
          ...(os === "linux" ? { libc: ["glibc"] } : {}),
          files: ["bin"],
        },
        null,
        2,
      ),
    )
    await Bun.write(join(dir, "LICENSE"), Bun.file(join(root, "LICENSE")))
    optionalDependencies[name] = metadata.version
  }
  const dir = join(dist, "npm", metadata.name)
  await Bun.write(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: metadata.name,
        version: metadata.version,
        description: metadata.description,
        keywords: metadata.keywords,
        homepage: metadata.homepage,
        bugs: metadata.bugs,
        license: metadata.license,
        author: metadata.author,
        repository: metadata.repository,
        bin: { "balatro-mcp": "cli.cjs" },
        files: ["cli.cjs"],
        engines: { node: ">=20" },
        optionalDependencies,
      },
      null,
      2,
    ),
  )
  await Bun.write(join(dir, "cli.cjs"), Bun.file(join(import.meta.dir, "cli.cjs")))
  await chmod(join(dir, "cli.cjs"), 0o755)
  for (const file of ["README.md", "LICENSE"]) {
    await Bun.write(join(dir, file), Bun.file(join(root, file)))
  }
}
