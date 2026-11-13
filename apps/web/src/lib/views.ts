import { z } from 'zod'

export const MAX_VIEWS_PER_BATCH = 10
export const MAX_VIEW_BODY_BYTES = 2 * 1024
export const VIEWS_PER_VIEWER_PER_HOUR = 200
export const MIN_VIEW_MS = 2000

const viewBodySchema = z.object({ itemIds: z.array(z.guid()).min(1).max(MAX_VIEWS_PER_BATCH) })

export type ViewBodyResult =
  { ok: true; itemIds: string[] } | { ok: false; reason: 'too_large' | 'not_json' | 'invalid' }

// sendBeacon posts text/plain, so the raw text is parsed regardless of content-type.
export function parseViewBody(raw: string): ViewBodyResult {
  if (raw.length > MAX_VIEW_BODY_BYTES) return { ok: false, reason: 'too_large' }
  let json: unknown
  try {
    json = JSON.parse(raw.trim())
  } catch {
    return { ok: false, reason: 'not_json' }
  }
  const parsed = viewBodySchema.safeParse(json)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  return { ok: true, itemIds: [...new Set(parsed.data.itemIds.map((id) => id.toLowerCase()))] }
}

/** How many of the requested views fit under the viewer's hourly allowance. */
export function viewAllowance(recentViews: number, requested: number): number {
  return Math.max(0, Math.min(requested, VIEWS_PER_VIEWER_PER_HOUR - recentViews))
}

/** Signed-in viewers count once per account, everyone else once per session cookie. */
export function viewerKey(profileId: string | null, sessionId: string): string {
  return profileId ? `u:${profileId}` : `s:${sessionId}`
}
