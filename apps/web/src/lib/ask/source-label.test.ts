import { describe, expect, it } from 'vitest'
import { chipLabel, hostOf, sourceKindOf } from './source-label'

describe('source-label', () => {
  it('maps urls to source kinds', () => {
    expect(sourceKindOf('https://news.ycombinator.com/item?id=1')).toBe('hn')
    expect(sourceKindOf('https://github.com/a/b')).toBe('github')
    expect(sourceKindOf('https://old.reddit.com/r/x')).toBe('reddit')
    expect(sourceKindOf('https://youtu.be/abc')).toBe('youtube')
    expect(sourceKindOf('https://arxiv.org/abs/1')).toBe('papers')
    expect(sourceKindOf('https://example.com/post')).toBe('news')
    expect(sourceKindOf('https://notgithub.com/x')).toBe('news')
  })

  it('builds short chip labels', () => {
    expect(chipLabel('https://github.com/a/b')).toBe('GitHub')
    expect(chipLabel('https://www.theverge.com/x')).toBe('theverge')
    expect(chipLabel('https://a-very-long-publication-name.example/x')).toHaveLength(18)
    expect(hostOf('not a url')).toBe('not a url')
  })
})
