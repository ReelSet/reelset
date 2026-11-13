import { describe, expect, it } from 'vitest'
import { FALLBACK_SUGGESTIONS, buildSuggestions, followupsFromTitles } from './suggestions'

describe('buildSuggestions', () => {
  it('builds four questions from the busiest topics and newest titles', () => {
    const out = buildSuggestions(
      [
        { label: 'databases', count: 3 },
        { label: 'ai', count: 9 },
        { label: 'web', count: 1 },
      ],
      ['Bun 2.0 ships a faster bundler', 'x', 'A'.repeat(90), 'Zig gets a new allocator!'],
    )
    expect(out).toEqual([
      'What is trending in AI this week?',
      'What are developers saying about Databases right now?',
      'What is the story behind Bun 2.0 ships a faster bundler?',
      'What is the story behind Zig gets a new allocator?',
    ])
  })

  it('pads with the static starters when data is thin', () => {
    expect(buildSuggestions([], [])).toEqual(FALLBACK_SUGGESTIONS)
  })
})

describe('followupsFromTitles', () => {
  it('turns cited titles into at most three follow-ups', () => {
    const out = followupsFromTitles([
      'Short',
      'Bun 2.0 is out',
      'Deno 3 released',
      'Zig 0.15 lands',
      'Go 2 plans',
    ])
    expect(out).toHaveLength(3)
    expect(out[0]).toBe('What else should I know about Bun 2.0 is out?')
  })
})
