import { z } from "zod"

export const cardIdSchema = z.union([z.string(), z.number().int()])

export type CardId = z.infer<typeof cardIdSchema>

export function normalizeCardId(cardId: CardId): string {
  return String(cardId)
}

export function normalizeCardIds(cardIds: CardId[]): string[] {
  return cardIds.map(normalizeCardId)
}
