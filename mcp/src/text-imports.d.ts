/**
 * Ambient type for Bun text imports.
 *
 * Bun imports file contents as raw strings via the `type: "text"` import
 * attribute, e.g. `import text from "./prompt.md" with { type: "text" }`.
 * The attribute overrides the default `.md` markdown loader in both the
 * runtime and the bundler. This declaration mirrors that contract so
 * `tsc --noEmit` accepts the imports.
 *
 * Note: only attribute imports (`with { type: "text" }`) are raw text; a
 * plain `.md` import renders markdown to HTML at runtime.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
