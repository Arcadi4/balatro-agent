import { createHash } from "node:crypto"

import type { McpServer } from "@modelcontextprotocol/server"

import editionsMarkdown from "../../data/card_modifiers/editions.md" with { type: "text" }
import enhancementsMarkdown from "../../data/card_modifiers/enhancements.md" with { type: "text" }
import indexMarkdown from "../../data/card_modifiers/index.md" with { type: "text" }
import sealsMarkdown from "../../data/card_modifiers/seals.md" with { type: "text" }
import stickersMarkdown from "../../data/card_modifiers/stickers.md" with { type: "text" }

export const CARD_MODIFIERS_URI = "balatro://card_modifiers"

const CARD_MODIFIERS_VERSION = createHash("sha256")
  .update(
    indexMarkdown + enhancementsMarkdown + sealsMarkdown + editionsMarkdown + stickersMarkdown,
  )
  .digest("hex")
  .slice(0, 8)

function registerCardModifiersSubresource(
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  markdown: string,
): void {
  server.registerResource(
    name,
    uri,
    {
      title,
      description: `Balatro card modifier reference (${title.toLowerCase()}). See balatro://card_modifiers for the index.`,
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: { version: CARD_MODIFIERS_VERSION },
    },
    () => ({
      contents: [{ uri, mimeType: "text/markdown", text: markdown }],
    }),
  )
}

const modifierPages = {
  index: { uri: CARD_MODIFIERS_URI, markdown: indexMarkdown },
  enhancements: { uri: `${CARD_MODIFIERS_URI}/enhancements`, markdown: enhancementsMarkdown },
  seals: { uri: `${CARD_MODIFIERS_URI}/seals`, markdown: sealsMarkdown },
  editions: { uri: `${CARD_MODIFIERS_URI}/editions`, markdown: editionsMarkdown },
  stickers: { uri: `${CARD_MODIFIERS_URI}/stickers`, markdown: stickersMarkdown },
} as const

export function readCardModifiersResource(
  subpath?: string,
): { uri: string; markdown: string } | undefined {
  if (!subpath || subpath === "" || subpath === "index") return modifierPages.index
  if (subpath === "enhancements") return modifierPages.enhancements
  if (subpath === "seals") return modifierPages.seals
  if (subpath === "editions") return modifierPages.editions
  if (subpath === "stickers") return modifierPages.stickers
  return undefined
}

export function registerCardModifiersResource(server: McpServer): void {
  server.registerResource(
    "card_modifiers",
    CARD_MODIFIERS_URI,
    {
      title: "Balatro Card Modifiers",
      description:
        "Balatro card modifier index: enhancement, seal, edition, and sticker rules with sub-page links.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 86_400_000, cacheScope: "public" },
      _meta: { version: CARD_MODIFIERS_VERSION },
    },
    () => ({
      contents: [{ uri: CARD_MODIFIERS_URI, mimeType: "text/markdown", text: indexMarkdown }],
    }),
  )

  registerCardModifiersSubresource(
    server,
    "card_modifiers_enhancements",
    `${CARD_MODIFIERS_URI}/enhancements`,
    "Balatro Card Enhancements",
    enhancementsMarkdown,
  )
  registerCardModifiersSubresource(
    server,
    "card_modifiers_seals",
    `${CARD_MODIFIERS_URI}/seals`,
    "Balatro Card Seals",
    sealsMarkdown,
  )
  registerCardModifiersSubresource(
    server,
    "card_modifiers_editions",
    `${CARD_MODIFIERS_URI}/editions`,
    "Balatro Card Editions",
    editionsMarkdown,
  )
  registerCardModifiersSubresource(
    server,
    "card_modifiers_stickers",
    `${CARD_MODIFIERS_URI}/stickers`,
    "Balatro Card Stickers",
    stickersMarkdown,
  )
}
