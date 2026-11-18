import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    plugins: ["oxc", "promise", "eslint", "typescript", "import", "unicorn"],
  },
  staged: { "*": "vp check --fix" },
  fmt: {
    ignorePatterns: ["mcp/dist/**"],
    sortImports: true,
    sortPackageJson: true,
    overrides: [
      {
        files: ["mcp/**"],
        options: { semi: false },
      },
    ],
  },
});
