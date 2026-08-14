import type { Element, ElementContent, Root as HastRoot } from "hast"
import type { Content as MdastContent, Root as MdastRoot, TableCell as MdastTableCell } from "mdast"
import rehypeParse from "rehype-parse"
import rehypeRemark from "rehype-remark"
import remarkGfm from "remark-gfm"
import remarkStringify from "remark-stringify"
import { unified } from "unified"
import type { Plugin } from "unified"
import { visit } from "unist-util-visit"

const WIKI_API_URL = "https://balatrowiki.org/api.php"
const WIKI_BASE_URL = "https://balatrowiki.org"
const WIKI_ARTICLE_PATH = "/w/"
const FETCH_TIMEOUT_MS = 15_000

export function wikiUrl(title: string): string {
  const normalized = title.charAt(0).toUpperCase() + title.slice(1)
  return `${WIKI_BASE_URL}${WIKI_ARTICLE_PATH}${encodeURIComponent(normalized.replace(/ /g, "_"))}`
}

export type WikiPage = {
  title: string
  markdown: string
  url: string
}

export type WikiSearchHit = {
  title: string
  wordcount: number
  snippet: string
  url: string
}

// Static tag lookup per repo convention (Record over Set for string keys).
const DROP_TAGS: Record<string, true> = {
  style: true,
  script: true,
  figure: true,
  figcaption: true,
  img: true,
  sup: true,
}

// Whole subtrees under these class prefixes are noise for a text consumer:
// chrome (edit links, TOC, navboxes, print footer, categories), invisible
// metadata (DPL query dumps), or image-only galleries. Matched by exact
// name or `prefix-`/`prefix_` (covers `consumables__container`).
const DROP_CLASS_PREFIXES: string[] = [
  "mw-editsection",
  "mw-references-wrap",
  "mw-jump-link",
  "navbox",
  "toc",
  "printfooter",
  "reflist",
  "metadata",
  "catlinks",
  "infobox-image-container",
  "consumables",
]

function classNames(node: Element): string[] {
  return node.properties?.className ?? []
}

function hasClass(node: Element, name: string): boolean {
  return classNames(node).includes(name)
}

function isDroppedClass(name: string): boolean {
  return DROP_CLASS_PREFIXES.some(
    (p) => name === p || name.startsWith(`${p}-`) || name.startsWith(`${p}_`),
  )
}

function isHidden(node: Element): boolean {
  const style = node.properties?.style
  return typeof style === "string" && /display\s*:\s*none/i.test(style)
}

function isFileAnchor(node: Element): boolean {
  if (node.tagName !== "a") return false
  return hasClass(node, "mw-file-description") || hasClass(node, "image")
}

function textOf(node: Element): string {
  let out = ""
  for (const child of node.children) {
    if (child.type === "text") out += child.value
    else if (child.type === "element" && child.tagName !== "style" && child.tagName !== "script") {
      out += textOf(child)
    }
  }
  return out.replace(/\u00a0/g, " ").trim()
}

// --- hast cleanup ------------------------------------------------------------
//
// One manual top-down walk. Rewriting `children` in place while recursing is
// easier to reason about than visitor index juggling for this rule set.

function isDroppedElement(node: Element): boolean {
  if (DROP_TAGS[node.tagName] === true) return true
  if (isHidden(node)) return true
  if (classNames(node).some(isDroppedClass)) return true
  if (isFileAnchor(node)) return true
  return false
}

function cleanChildren(node: Element | HastRoot): void {
  const kept: Array<(typeof node.children)[number]> = []
  for (const child of node.children) {
    if (child.type !== "element" || !isDroppedElement(child)) kept.push(child)
  }
  const survivors: Array<(typeof node.children)[number]> = []
  for (const child of kept) {
    if (child.type !== "element") {
      survivors.push(child)
      continue
    }
    cleanElement(child)
    // Anchors that only wrapped a now-dropped icon would render as empty
    // links; drop them.
    if (child.tagName === "a" && textOf(child) === "") continue
    survivors.push(child)
  }
  node.children = survivors
}

function fixLink(node: Element): void {
  if (node.tagName !== "a") return
  // Link titles duplicate the anchor text on this wiki; drop for lean output.
  delete node.properties?.title
  const href = node.properties?.href
  const isSelfLink = hasClass(node, "mw-selflink")
  if (isSelfLink || typeof href !== "string" || href.startsWith("#")) {
    // Self links and same-page fragments render as plain text.
    node.tagName = "span"
    node.properties = {}
  } else if (href.startsWith("/w/")) {
    node.properties.href = `${WIKI_BASE_URL}${href}`
  }
  trimLeadingSpace(node)
}

// J-template anchors carry a leading no-break space that separated them from
// a now-dropped icon; strip it from the first text node.
function trimLeadingSpace(node: Element): void {
  for (const child of node.children) {
    if (child.type === "text") {
      child.value = child.value.replace(/^[\u00a0\s]+/, "")
      return
    }
    if (child.type === "element") {
      trimLeadingSpace(child)
      return
    }
  }
}

// --- infobox -----------------------------------------------------------------

function paragraph(children: ElementContent[]): Element {
  return { type: "element", tagName: "p", properties: {}, children }
}

function strong(text: string): Element {
  return {
    type: "element",
    tagName: "strong",
    properties: {},
    children: [{ type: "text", value: text }],
  }
}

function em(text: string): Element {
  return {
    type: "element",
    tagName: "em",
    properties: {},
    children: [{ type: "text", value: text }],
  }
}

function findByClass(node: Element | HastRoot, name: string, depth = 0): Element | undefined {
  if (depth > 20) return undefined
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (hasClass(child, name)) return child
    const nested = findByClass(child, name, depth + 1)
    if (nested) return nested
  }
  return undefined
}

function findAllByClass(node: Element | HastRoot, name: string, depth = 0): Element[] {
  if (depth > 20) return []
  const out: Element[] = []
  for (const child of node.children) {
    if (child.type !== "element") continue
    if (hasClass(child, name)) out.push(child)
    out.push(...findAllByClass(child, name, depth + 1))
  }
  return out
}
function topLevelGroups(node: Element | HastRoot): Element[] {
  const out: Element[] = []
  const walk = (current: Element | HastRoot): void => {
    for (const child of current.children) {
      if (child.type !== "element") continue
      if (hasClass(child, "infobox-group")) {
        out.push(child)
        continue
      }
      walk(child)
    }
  }
  walk(node)
  return out
}

function containsNode(haystack: Element, needle: Element): boolean {
  for (const child of haystack.children) {
    if (child.type !== "element") continue
    if (child === needle || containsNode(child, needle)) return true
  }
  return false
}
// Infoboxes are structured DOM: a title, image-only tabs (dropped), and
// labeled field groups. Each group is either a simple field
// (`Effect: ...`) or a titled set of labeled rows (Stats: Buy/Sell/Type).
function rowLine(label: string, value: string): Element {
  return {
    type: "element",
    tagName: "li",
    properties: {},
    children: [strong(`${label}:`), { type: "text", value: ` ${value}` }],
  }
}

function groupLines(group: Element, content: ElementContent[]): void {
  const header = textOf(findByClass(group, "infobox-header") ?? group)
  const rows = findAllByClass(group, "infobox-row-container")
  const labeled: Array<[string, string]> = []
  const unlabeled: string[] = []
  for (const row of rows) {
    const label = findByClass(row, "infobox-row-label")
    const value = findAllByClass(row, "infobox-row-value__inner")
      .map(textOf)
      .filter(Boolean)
      .join(" · ")
    const labelText = label === undefined ? "" : textOf(label)
    if (labelText) labeled.push([labelText, value])
    else if (value) unlabeled.push(value)
  }
  if (labeled.length > 0) {
    if (header) content.push(paragraph([strong(header)]))
    content.push({
      type: "element",
      tagName: "ul",
      properties: {},
      children: labeled.map(([l, v]) => rowLine(l, v)),
    })
  } else {
    const value = unlabeled.join(" · ")
    content.push(paragraph([strong(`${header}:`), { type: "text", value: ` ${value}` }]))
  }
}

function convertInfobox(root: Element): void {
  const title = textOf(findByClass(root, "infobox-title") ?? root)
  const content: ElementContent[] = []
  if (title) content.push(paragraph([strong(title)]))
  for (const group of topLevelGroups(root)) {
    groupLines(group, content)
  }
  root.children = content
}

// --- mdast post-processing ---------------------------------------------------

// GFM table cells are a single inline line; block children (paragraphs, line
// breaks) serialize flattened into a space. Re-join them with literal <br>
// nodes, which remark-stringify keeps inside cells.
const cellBreaks: Plugin<[], MdastRoot, MdastRoot> = () => (tree) => {
  visit(tree, "tableCell", (cell: MdastTableCell) => {
    // GFM cells hold block content at runtime (rehype-remark emits paragraphs),
    // but mdast's TableCell types only phrasing; widen once, deliberately.
    const children = cell.children as MdastContent[]
    const flat: MdastContent[] = []
    for (const child of children) {
      if (child.type === "break") {
        if (flat.length > 0) flat.push({ type: "html", value: "<br>" })
      } else if (child.type === "paragraph") {
        const inner = (child as unknown as { children: MdastContent[] }).children.filter(
          (c) => !(c.type === "text" && c.value.trim() === ""),
        )
        if (inner.length === 0) continue
        if (flat.length > 0) flat.push({ type: "html", value: "<br>" })
        flat.push(...inner)
      } else {
        flat.push(child)
      }
    }
    cell.children = flat as unknown as MdastTableCell["children"]
  })
}
function cleanElement(node: Element): void {
  if (hasClass(node, "infobox-root")) {
    convertInfobox(node)
    return
  }
  if (node.tagName === "math") {
    replaceWithText(node, mathText(node))
    return
  }
  fixLink(node)
  cleanChildren(node)
}

function replaceWithText(node: Element, text: string): void {
  node.tagName = "span"
  node.properties = {}
  node.children = [{ type: "text", value: text }]
}

// Linearize MathML (MathJax output) into readable text: x^(x^2) etc.
function mathText(node: Element): string {
  if (node.tagName === "mspace") return " "
  if (node.tagName === "msup") {
    const parts = node.children.filter((c): c is Element => c.type === "element")
    const base = parts[0] === undefined ? "" : mathText(parts[0])
    const exp = parts[1] === undefined ? "" : mathText(parts[1])
    return `${base}^(${exp})`
  }
  if (node.tagName === "msub") {
    const parts = node.children.filter((c): c is Element => c.type === "element")
    const base = parts[0] === undefined ? "" : mathText(parts[0])
    const sub = parts[1] === undefined ? "" : mathText(parts[1])
    return `${base}_${sub}`
  }
  let out = ""
  for (const child of node.children) {
    if (child.type === "text") out += child.value
    else if (child.type === "element") out += mathText(child)
  }
  return out
}

const processor = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeRemark, { newlines: true })
  .use(cellBreaks)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: "-", emphasis: "_", strong: "*" })

export async function htmlToMarkdown(html: string): Promise<string> {
  const tree = processor.parse(html)
  cleanChildren(tree)
  const mdast = await processor.run(tree)
  return processor.stringify(mdast)
}

// --- MediaWiki API -----------------------------------------------------------

async function callApi(params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams(params)
  const response = await fetch(`${WIKI_API_URL}?${query}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  })
  if (!response.ok) throw new Error(`WIKI_HTTP_${response.status}`)
  const body: unknown = await response.json()
  if (body !== null && typeof body === "object" && "error" in body) {
    const err = body.error
    const apiCode =
      err !== null && typeof err === "object" && "code" in err && typeof err.code === "string"
        ? err.code
        : "unknown"
    // `missingtitle` is the API's page-not-found; surface it as a stable code.
    const code = apiCode === "missingtitle" ? "WIKI_PAGE_NOT_FOUND" : `WIKI_API_ERROR_${apiCode}`
    throw new Error(code)
  }
  return body
}

export async function fetchWikiPage(title: string): Promise<WikiPage> {
  const body = await callApi({
    action: "parse",
    page: title,
    prop: "text",
    format: "json",
    formatversion: "2",
    redirects: "1",
    disabletoc: "1",
    disableeditsection: "1",
    disablelimitreport: "1",
  })
  const parse = readParseResponse(body)
  const html = parse?.text
  if (parse === undefined || html === undefined) throw new Error("WIKI_PAGE_NOT_FOUND")
  const pageTitle = parse.title ?? title
  return { title: pageTitle, markdown: await htmlToMarkdown(html), url: wikiUrl(pageTitle) }
}

type ParseResponse = { title?: string; text?: string }

function readParseResponse(body: unknown): ParseResponse | undefined {
  if (body === null || typeof body !== "object" || !("parse" in body)) return undefined
  const parse: unknown = body.parse
  if (parse === null || typeof parse !== "object") return undefined
  const out: ParseResponse = {}
  if ("title" in parse && typeof parse.title === "string") out.title = parse.title
  if ("text" in parse && typeof parse.text === "string") out.text = parse.text
  return out
}

// Search snippets carry <span class="searchmatch"> highlights plus stray
// wikitext from infobox transclusions; keep the words, drop the markup.
function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#160;|\u00a0/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export async function searchWiki(query: string, limit = 10): Promise<WikiSearchHit[]> {
  const body = await callApi({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: String(limit),
    format: "json",
    formatversion: "2",
  })
  return readSearchResults(body).map((hit) => ({
    title: hit.title ?? "",
    wordcount: hit.wordcount ?? 0,
    snippet: cleanSnippet(hit.snippet ?? ""),
    url: wikiUrl(hit.title ?? ""),
  }))
}

type SearchHit = { title?: string; wordcount?: number; snippet?: string }

function readSearchResults(body: unknown): SearchHit[] {
  if (body === null || typeof body !== "object" || !("query" in body)) return []
  const query: unknown = body.query
  if (query === null || typeof query !== "object" || !("search" in query)) return []
  const search: unknown = query.search
  if (!Array.isArray(search)) return []
  return search.filter((hit): hit is SearchHit => hit !== null && typeof hit === "object")
}
