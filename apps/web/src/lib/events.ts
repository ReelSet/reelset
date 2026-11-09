import { EventName } from '@reelset/core'
import { z } from 'zod'

const EVENT_NAMES = Object.values(EventName) as [EventName, ...EventName[]]

const ITEM_EVENTS: readonly EventName[] = [
  EventName.reel_start,
  EventName.reel_complete,
  EventName.like,
  EventName.unlike,
  EventName.item_open,
]

export const MAX_EVENTS_PER_BATCH = 20

const metaSchema = z
  .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine((meta) => Object.keys(meta).length <= 10, 'meta has too many keys')

const eventSchema = z
  .object({
    name: z.enum(EVENT_NAMES),
    itemId: z.guid().optional(),
    meta: metaSchema.optional(),
  })
  .superRefine((event, ctx) => {
    if (ITEM_EVENTS.includes(event.name) && !event.itemId) {
      ctx.addIssue({ code: 'custom', path: ['itemId'], message: `${event.name} needs itemId` })
    }
    if (event.name === EventName.reel_complete) {
      const ratio = event.meta?.watchRatio
      if (typeof ratio !== 'number' || ratio < 0 || ratio > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['meta', 'watchRatio'],
          message: 'reel_complete needs watchRatio between 0 and 1',
        })
      }
    }
  })

export const eventBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
})

export type EventInput = z.infer<typeof eventSchema>

export function parseEventBatch(
  body: unknown,
): { ok: true; events: EventInput[] } | { ok: false; issues: string[] } {
  const parsed = eventBatchSchema.safeParse(body)
  if (parsed.success) return { ok: true, events: parsed.data.events }
  return {
    ok: false,
    issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}

export const MAX_EVENT_BODY_BYTES = 16 * 1024

export type EventBodyResult =
  { ok: true; json: unknown } | { ok: false; reason: 'empty' | 'too_large' | 'not_json' }

// sendBeacon posts Blobs as text/plain or application/json depending on the browser, so the
// content-type is ignored and the raw text is parsed instead.
export function parseEventBody(raw: string): EventBodyResult {
  if (raw.length > MAX_EVENT_BODY_BYTES) return { ok: false, reason: 'too_large' }
  const text = raw.replace(/^﻿/, '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  try {
    return { ok: true, json: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'not_json' }
  }
}
