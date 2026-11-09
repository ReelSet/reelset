import { describe, expect, it } from 'vitest'
import { parseEventBatch } from './events'

const itemId = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'

describe('parseEventBatch', () => {
  it('accepts a valid mixed batch', () => {
    const result = parseEventBatch({
      events: [
        { name: 'feed_view' },
        { name: 'reel_start', itemId },
        { name: 'reel_complete', itemId, meta: { watchRatio: 0.8 } },
        { name: 'ask_submit' },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects unknown event names', () => {
    expect(parseEventBatch({ events: [{ name: 'page_exploded' }] }).ok).toBe(false)
  })

  it('requires watchRatio in [0, 1] on reel_complete', () => {
    expect(parseEventBatch({ events: [{ name: 'reel_complete', itemId }] }).ok).toBe(false)
    expect(
      parseEventBatch({ events: [{ name: 'reel_complete', itemId, meta: { watchRatio: 1.5 } }] })
        .ok,
    ).toBe(false)
  })

  it('requires itemId on item-scoped events', () => {
    expect(parseEventBatch({ events: [{ name: 'like' }] }).ok).toBe(false)
  })

  it('rejects empty, oversized and malformed batches', () => {
    expect(parseEventBatch({ events: [] }).ok).toBe(false)
    expect(parseEventBatch({ events: Array(21).fill({ name: 'feed_view' }) }).ok).toBe(false)
    expect(parseEventBatch(null).ok).toBe(false)
    expect(
      parseEventBatch({ events: [{ name: 'feed_view', meta: { a: { nested: 1 } } }] }).ok,
    ).toBe(false)
  })

  it('reports issues for debugging', () => {
    const result = parseEventBatch({ events: [{ name: 'nope' }] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toContain('events.0.name')
  })
})
