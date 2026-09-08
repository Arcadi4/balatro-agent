export const targets = [
  { os: "darwin", cpu: "arm64", target: "bun-darwin-arm64" },
  { os: "darwin", cpu: "x64", target: "bun-darwin-x64" },
  { os: "linux", cpu: "arm64", target: "bun-linux-arm64" },
  { os: "linux", cpu: "x64", target: "bun-linux-x64" },
  { os: "win32", cpu: "x64", target: "bun-windows-x64" },
] as const
