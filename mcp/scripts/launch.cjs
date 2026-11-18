const { spawn } = require("node:child_process")

function launch(name) {
  const packageName = `@balatro-mcp/${process.platform}-${process.arch}`
  const executable = process.platform === "win32" ? `${name}.exe` : name
  let binary
  try {
    binary = require.resolve(`${packageName}/bin/${executable}`)
  } catch {
    console.error(
      `No ${name} binary for ${process.platform}/${process.arch}. ` +
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
    console.error(`Unable to start ${name}: ${error.message}`)
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
  })
}

module.exports = launch
