const commands: Record<string, string> = {
  doctor: "Check local Balatro, Lovely, and SMODS paths",
  "install:mods": "Sync mod/ into the Balatro Mods directory",
  run: "Install the mod, then launch Balatro with Lovely (extra args are forwarded)",
  bump: "Bump major, minor, or patch (default: patch), commit, and tag",
  dev: "Run the MCP server with watch mode",
  build: "Build the MCP server",
  typecheck: "Typecheck root scripts and the MCP package",
  test: "Run MCP tests",
  format: "Format the MCP package",
  "build:release": "Build release binaries and npm packages",
};

console.log("Balatro Agent development commands\n");
for (const [name, description] of Object.entries(commands)) {
  console.log(`  bun run ${name.padEnd(15)} ${description}`);
}
console.log("\nConfiguration: BALATRO_DIR, BALATRO_SAVE override the macOS defaults.");
