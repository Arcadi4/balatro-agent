#!/usr/bin/env bun
// Bumps the release version shared by mod/manifest.json and mcp/package.json.
// Only the version line is rewritten so the diff stays a single line per file.

import { readFile, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"

const root = join(import.meta.dir, "..")
const files = [join(root, "mod", "manifest.json"), join(root, "mcp", "package.json")]
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/
const versionLine = /^([ \t]*)"version"[ \t]*:[ \t]*"([^"]*)"/m

type Parsed = { core: number[]; pre: string | undefined }

const parse = (version: string): Parsed | undefined => {
  const match = semver.exec(version)
  if (match === null) {
    return undefined
  }
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] }
}

const compare = (a: Parsed, b: Parsed): number => {
  for (let index = 0; index < a.core.length; index++) {
    const delta = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (delta !== 0) {
      return delta < 0 ? -1 : 1
    }
  }
  if (a.pre === b.pre) {
    return 0
  }
  if (a.pre === undefined) {
    return 1
  }
  if (b.pre === undefined) {
    return -1
  }
  return a.pre < b.pre ? -1 : 1
}

const requested = process.argv[2]
if (requested === undefined) {
  console.error("usage: bun scripts/bump-version.ts <version>")
  process.exit(2)
}
const next = parse(requested)
if (next === undefined) {
  console.error(`Not a release version: ${requested} (expected MAJOR.MINOR.PATCH[-prerelease])`)
  process.exit(2)
}

const readVersion = (text: string, path: string): string => {
  const match = versionLine.exec(text)
  if (match === null) {
    throw new Error(`no "version" field in ${relative(root, path)}`)
  }
  return match[2] ?? ""
}

const sources = await Promise.all(
  files.map(async (path) => {
    const text = await readFile(path, "utf8")
    return { path, text, current: readVersion(text, path) }
  }),
)

const drifted = sources.filter((source) => source.current !== sources[0]?.current)
if (drifted.length > 0) {
  for (const source of sources) {
    console.error(`${relative(root, source.path)}: ${source.current}`)
  }
  console.error("Versions are out of sync; reconcile them before bumping.")
  process.exit(1)
}

const currentVersion = sources[0]?.current ?? ""
const current = parse(currentVersion)
if (current === undefined) {
  console.error(`Current version is not valid semver: ${currentVersion}`)
  process.exit(1)
}
if (compare(next, current) <= 0) {
  console.error(`New version ${requested} must be greater than current ${currentVersion}.`)
  process.exit(1)
}

for (const source of sources) {
  await writeFile(source.path, source.text.replace(versionLine, `$1"version": "${requested}"`))
  console.log(`${relative(root, source.path)}: ${currentVersion} -> ${requested}`)
}

console.log(`\nNext: git add mod/manifest.json mcp/package.json`)
console.log(`      git commit -m "release: v${requested}"`)
console.log(`      git tag -a "v${requested}" -m "v${requested}" && git push --follow-tags`)
