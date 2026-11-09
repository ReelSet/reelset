import { z } from 'zod'

// asOf pins the candidate pool and the freshness clock for the whole scrolling session, so the
// ranked order is identical on every page and an offset is a stable position.
export type FeedCursor = { asOf: string; offset: number }

const AS_OF_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const MAX_OFFSET = 10_000

const cursorSchema = z.object({
  v: z.literal(1),
  a: z.string().regex(AS_OF_RE),
  o: z.number().int().min(0).max(MAX_OFFSET),
})

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, a: cursor.asOf, o: cursor.offset })).toString(
    'base64url',
  )
}

export function decodeCursor(raw: string | null | undefined): FeedCursor | null {
  if (!raw || raw.length > 200) return null
  try {
    const json: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    const parsed = cursorSchema.safeParse(json)
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data.a))) return null
    return { asOf: parsed.data.a, offset: parsed.data.o }
  } catch {
    return null
  }
}

export const DEFAULT_FEED_LIMIT = 8
export const MAX_FEED_LIMIT = 24

export function clampLimit(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return DEFAULT_FEED_LIMIT
  return Math.min(MAX_FEED_LIMIT, Math.max(1, Math.trunc(raw)))
}
