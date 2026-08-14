// Local page-render smoke test: fetch + convert wiki pages, print markdown.
import { fetchWikiPage } from "../src/wiki.js"

const titles = process.argv.slice(2)
for (const title of titles) {
  try {
    const page = await fetchWikiPage(title)
    const file = `/tmp/wiki-md-${title.replace(/[^A-Za-z0-9_-]/g, "_")}.md`
    await Bun.write(file, `# ${page.title}\n\n> Source: ${page.url}\n\n${page.markdown}`)
    console.log(`${title} -> ${file} (${page.markdown.length} chars)`)
  } catch (err) {
    console.log(`${title} -> ERROR: ${err instanceof Error ? err.message : String(err)}`)
  }
}
