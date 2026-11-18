import { chmod, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import metadata from "../package.json"
import { targets } from "./platforms.js"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const release = Bun.argv.includes("--release")
const executables = [
  { entry: "src/index.ts", name: "balatro-mcp" },
  { entry: "src/cli.ts", name: "balatro" },
] as const
const stubs = ["cli.cjs", "balatro.cjs"] as const
const launcher = "launch.cjs"

function executableName(name: string, os: string): string {
  return `${name}${os === "win32" ? ".exe" : ""}`
}

async function buildExecutable(
  entry: string,
  outfile: string,
  target?: (typeof targets)[number]["target"],
): Promise<void> {
  await Bun.build({
    entrypoints: [join(root, entry)],
    compile: target === undefined ? { outfile } : { target, outfile },
    minify: true,
    sourcemap: "linked",
  })
  await chmod(outfile, 0o755)
}

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
process.chdir(dist)

if (!release) {
  for (const { entry, name } of executables) {
    await buildExecutable(entry, join(dist, executableName(name, process.platform)))
  }
} else {
  const optionalDependencies: Record<string, string> = {}
  for (const { os, cpu, target } of targets) {
    const name = `@balatro-mcp/${os}-${cpu}`
    const dir = join(dist, "npm", `${os}-${cpu}`)
    for (const { entry, name: executable } of executables) {
      const binary = executableName(executable, os)
      await buildExecutable(entry, join(dir, "bin", binary), target)
    }
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
        bin: { "balatro-mcp": "cli.cjs", balatro: "balatro.cjs" },
        files: [...stubs, launcher],
        engines: { node: ">=20" },
        optionalDependencies,
      },
      null,
      2,
    ),
  )
  for (const file of [...stubs, launcher]) {
    await Bun.write(join(dir, file), Bun.file(join(import.meta.dir, file)))
  }
  for (const stub of stubs) {
    await chmod(join(dir, stub), 0o755)
  }
  for (const file of ["README.md", "LICENSE"]) {
    await Bun.write(join(dir, file), Bun.file(join(root, file)))
  }
}
