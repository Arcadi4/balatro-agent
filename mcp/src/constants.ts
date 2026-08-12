/**
 * Server-wide constants enforced by the response shaper and list tools.
 *
 * - CHARACTER_LIMIT: maximum size of any single tool/resource response payload
 *   (text content + serialized structuredContent). Responses exceeding this MUST
 *   be truncated and include a truncation_message with offset/filter guidance.
 * - LIST_LIMIT: default page size for list-style tools.
 * - LIST_LIMIT_MAX: hard ceiling for the `limit` parameter on list-style tools.
 */
export const CHARACTER_LIMIT = 25_000
export const LIST_LIMIT = 20
export const LIST_LIMIT_MAX = 100
