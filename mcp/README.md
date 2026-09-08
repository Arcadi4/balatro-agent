<div align="center">

# balatro-mcp

[![npm version](https://img.shields.io/npm/v/balatro-mcp?style=flat-square)](https://www.npmjs.com/package/balatro-mcp) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-3c873a?style=flat-square)](https://nodejs.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

</div>

Use this MCP server with the [game mod](https://www.nexusmods.com/games/balatro/mods/927) to allow AI agents play Balatro.

[GitHub](https://github.com/Arcadi4/balatro-agent)

Run `npx -y balatro-mcp`. The npm package selects a native executable for macOS
(arm64/x64), Linux (glibc, arm64/x64), or Windows (x64). Bun is embedded in the
executable; users do not need to install it. Keep npm optional dependencies enabled.
The native archives on [GitHub Releases](https://github.com/Arcadi4/balatro-agent/releases)
can also run directly, without Node or Bun. Use the executable path as your MCP
client's command. `balatro-mcp --version` prints its version without opening a session.

## Development

Install [Bun](https://bun.com) 1.4.2 or later, then run these commands in `mcp/`:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run format
bun run dev
bun run build
```

The local build produces `dist/balatro-mcp` (`dist/balatro-mcp.exe` on Windows).
Development, formatting, typechecking, and compilation all run with Bun; Node is
not required. `bunfig.toml` forces package executables to use Bun and selects Bun's
cross-platform shell. `node:net`, `node:path`, and `node:os` imports use Bun's built-in
compatibility APIs, including Windows named pipes. The MCP SDK owns stdio.

Postgame files use Bun file I/O, globbing, and YAML. Reference hashes use
`Bun.CryptoHasher`. The wiki keeps its HTML-to-Markdown pipeline because Bun's
Markdown API converts Markdown to HTML; the custom infobox, MathML, and table
conversion still needs an HTML tree.

## Releases

`bun run build:release` creates five platform packages and the `balatro-mcp` launcher
under `dist/npm/`. It downloads Bun's cross-compilation runtimes on first use.
The source package is private to prevent accidentally publishing it; only generated
packages are published. Each launcher dependency is pinned to the exact release
version. The launcher uses Node supplied by npx solely to start the native server,
inherit stdio, forward signals, and return its exit status.

After registering the `@balatro-mcp` npm organization, run once from `mcp/`:

```sh
bun run release:setup
```

Sign in as an npm organization owner. When npm asks for 2FA, select the option to
skip further verification for five minutes. The command creates any missing binary
packages as `0.0.0` under a `bootstrap` tag, then configures their GitHub OIDC trusted
publishers. It uses your native npm executable for the interactive login and trust flow
when one is installed, falling back to npm through Bun otherwise. Each trust command
keeps the terminal attached so npm can complete its browser-based 2FA flow. If setup is
interrupted, rerun it for packages that have not been trusted yet; npm permits one trust
configuration per package.

For each release, bump the mod and MCP versions together and push the matching
`v<version>` tag. The workflow:

1. Validates Lua and TypeScript, builds binaries, and checks each on a matching runner.
2. Publishes `@balatro-mcp/{os}-{cpu}` automatically with provenance. Already published
   versions are skipped on retries.
3. Stages only `balatro-mcp` for your usual npm approval, after all binaries exist.
4. Uploads the mod and native archives to GitHub Releases.

You manage one version and approve one launcher package per release. No individual
binary package approvals or expiring publish tokens are required. Node/npm are used
only for registry operations; development, builds, and the release workflow's build
job run with Bun.

See [npm bulk trusted-publisher setup](https://docs.npmjs.com/cli/v11/commands/npm-trust/#bulk-usage)
for the shared 2FA session behavior.
