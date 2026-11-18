import type { ReadResourceResult, Resource } from "@modelcontextprotocol/server"

import editionsMarkdown from "../../data/card_modifiers/editions.md" with { type: "text" }
import enhancementsMarkdown from "../../data/card_modifiers/enhancements.md" with { type: "text" }
import indexMarkdown from "../../data/card_modifiers/index.md" with { type: "text" }
import sealsMarkdown from "../../data/card_modifiers/seals.md" with { type: "text" }
import stickersMarkdown from "../../data/card_modifiers/stickers.md" with { type: "text" }
import challengesMarkdown from "../../data/reference/challenges.md" with { type: "text" }
import decksMarkdown from "../../data/reference/decks.md" with { type: "text" }
import stakesMarkdown from "../../data/reference/stakes.md" with { type: "text" }
import type { ResourceDefinition } from "./catalog.js"

const MARKDOWN_MIME_TYPE = "text/markdown"

const MARKDOWN_CACHE_HINT = { ttlMs: 86_400_000, cacheScope: "public" } as const

type StaticMarkdownMetadata = Omit<Resource, "uri" | "name"> & {
  cacheHint: typeof MARKDOWN_CACHE_HINT
}

export interface MarkdownResourceSpec {
  readonly name: string
  readonly uri: string
  readonly title: string
  readonly description: string
  readonly markdown: string
  /** Defaults to the version hash of this Markdown. */
  readonly version?: string
}

function markdownVersion(...markdown: string[]): string {
  return Bun.CryptoHasher.hash("sha256", markdown.join(""), "hex").slice(0, 8)
}

/** Builds one immutable Markdown resource with the shared static cache policy. */
export function markdownResource(spec: MarkdownResourceSpec): ResourceDefinition {
  const version = spec.version ?? markdownVersion(spec.markdown)
  const metadata: StaticMarkdownMetadata = {
    title: spec.title,
    description: spec.description,
    mimeType: MARKDOWN_MIME_TYPE,
    cacheHint: MARKDOWN_CACHE_HINT,
    _meta: { version },
  }
  return {
    name: spec.name,
    uri: spec.uri,
    metadata,
    read: (): ReadResourceResult => ({
      contents: [{ uri: spec.uri, mimeType: MARKDOWN_MIME_TYPE, text: spec.markdown }],
    }),
  }
}

const CARD_MODIFIERS_URI = "balatro://card_modifiers"

const CARD_MODIFIERS_VERSION = markdownVersion(
  indexMarkdown,
  enhancementsMarkdown,
  sealsMarkdown,
  editionsMarkdown,
  stickersMarkdown,
)

function cardModifierResource(
  name: string,
  slug: string,
  title: string,
  markdown: string,
): ResourceDefinition {
  return markdownResource({
    name,
    uri: `${CARD_MODIFIERS_URI}/${slug}`,
    title,
    description: `Balatro card modifier reference (${title.toLowerCase()}). See ${CARD_MODIFIERS_URI} for the index.`,
    markdown,
    version: CARD_MODIFIERS_VERSION,
  })
}

const cardModifierResources: readonly ResourceDefinition[] = [
  markdownResource({
    name: "card_modifiers",
    uri: CARD_MODIFIERS_URI,
    title: "Balatro Card Modifiers",
    description:
      "Balatro card modifier index: enhancement, seal, edition, and sticker rules with sub-page links.",
    markdown: indexMarkdown,
    version: CARD_MODIFIERS_VERSION,
  }),
  cardModifierResource(
    "card_modifiers_enhancements",
    "enhancements",
    "Balatro Card Enhancements",
    enhancementsMarkdown,
  ),
  cardModifierResource("card_modifiers_seals", "seals", "Balatro Card Seals", sealsMarkdown),
  cardModifierResource(
    "card_modifiers_editions",
    "editions",
    "Balatro Card Editions",
    editionsMarkdown,
  ),
  cardModifierResource(
    "card_modifiers_stickers",
    "stickers",
    "Balatro Card Stickers",
    stickersMarkdown,
  ),
]

export const referenceResources: readonly ResourceDefinition[] = [
  ...cardModifierResources,
  markdownResource({
    name: "challenges",
    uri: "balatro://challenges",
    title: "Balatro Challenges",
    description:
      "Balatro challenge reference: challenge ids and rule summaries for balatro_new_game.",
    markdown: challengesMarkdown,
  }),
  markdownResource({
    name: "decks",
    uri: "balatro://decks",
    title: "Balatro Decks",
    description:
      "Balatro deck reference: playable deck keys and effect summaries for balatro_new_game.",
    markdown: decksMarkdown,
  }),
  markdownResource({
    name: "stakes",
    uri: "balatro://stakes",
    title: "Balatro Stakes",
    description:
      "Balatro stake reference: stake difficulties 1-8 and modifier summaries for balatro_new_game.",
    markdown: stakesMarkdown,
  }),
]
