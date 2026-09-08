#!/usr/bin/env node

const { spawn } = require("node:child_process")

const name = `@balatro-mcp/${process.platform}-${process.arch}`
const executable = process.platform === "win32" ? "balatro-mcp.exe" : "balatro-mcp"
let binary
try {
  binary = require.resolve(`${name}/bin/${executable}`)
} catch {
  console.error(
    `No balatro-mcp binary for ${process.platform}/${process.arch}. ` +
      "Supported: macOS arm64/x64, Linux glibc arm64/x64, Windows x64. " +
      "Install with optional dependencies enabled.",
  )
  process.exit(1)
}

const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" })
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
child.on("error", (error) => {
  console.error(`Unable to start balatro-mcp: ${error.message}`)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
})
