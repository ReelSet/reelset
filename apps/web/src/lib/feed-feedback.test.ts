import { describe, expect, it } from 'vitest'
import { emptyFeedback, hideItem, isSuppressed, muteTopics, parseFeedback } from './feed-feedback'

describe('parseFeedback', () => {
  it('survives missing, broken and foreign data', () => {
    expect(parseFeedback(null)).toEqual(emptyFeedback())
    expect(parseFeedback('{nope')).toEqual(emptyFeedback())
    expect(parseFeedback('{"hidden":[1,"a"],"muted":"x"}')).toEqual({ hidden: ['a'], muted: [] })
  })
})

describe('hideItem and muteTopics', () => {
  it('records once and normalises topic labels to slugs', () => {
    let state = hideItem(emptyFeedback(), 'a')
    state = hideItem(state, 'a')
    state = muteTopics(state, ['Open Source', 'open-source'])
    expect(state).toEqual({ hidden: ['a'], muted: ['open-source'] })
  })

  it('keeps only the most recent hidden ids', () => {
    let state = emptyFeedback()
    for (let i = 0; i < 320; i++) state = hideItem(state, `id${i}`)
    expect(state.hidden).toHaveLength(300)
    expect(state.hidden.at(-1)).toBe('id319')
  })
})

describe('isSuppressed', () => {
  const item = (id: string, topics: string[]) => ({ id, topics })

  it('always hides a hidden reel unless it is the kept one', () => {
    const state = hideItem(emptyFeedback(), 'a')
    expect(isSuppressed(state, item('a', []))).toBe(true)
    expect(isSuppressed(state, item('a', []), { keep: 'a' })).toBe(false)
    expect(isSuppressed(state, item('b', []))).toBe(false)
  })

  it('thins out muted topics without removing them all', () => {
    const state = muteTopics(emptyFeedback(), ['rust'])
    const ids = Array.from({ length: 60 }, (_, i) => `reel-${i}`)
    const shown = ids.filter((id) => !isSuppressed(state, item(id, ['Rust'])))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(ids.length / 2)
    expect(ids.every((id) => !isSuppressed(state, item(id, ['go'])))).toBe(true)
  })

  it('leaves a feed scoped to the muted topic alone', () => {
    const state = muteTopics(emptyFeedback(), ['rust'])
    expect(isSuppressed(state, item('x', ['rust']), { scopedTopic: 'rust' })).toBe(false)
  })
})
