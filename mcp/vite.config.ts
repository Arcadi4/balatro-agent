import { defineConfig } from "vite-plus"

export default defineConfig({
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    plugins: ["oxc", "promise", "eslint", "typescript", "import", "unicorn"],
  },
  fmt: {
    ignorePatterns: [],
    semi: false,
    sortImports: true,
    sortPackageJson: true,
  },
})
