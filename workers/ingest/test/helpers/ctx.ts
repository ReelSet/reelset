import type { FetchContext } from '../../src/types'

export function makeCtx(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    mode: 'incremental',
    range: { after: new Date('2026-11-08T00:00:00Z'), before: null },
    maxPages: 3,
    hostIntervalMs: 0,
    deadlineAt: performance.now() + 60_000,
    now: new Date('2026-11-09T12:00:00Z'),
    githubToken: 'gh-token',
    settings: {
      redditSubreddits: [],
      youtubeSearchQueries: ['rust tutorial', 'ai agents'],
      youtubeMaxAgeDays: 7,
      youtubeResultsPerQuery: 10,
      newsFeeds: [],
      papersHfLimit: 50,
      papersArxivCategories: ['cs.AI', 'cs.CL'],
      papersArxivPerCategory: 10,
      papersMaxAgeDays: 7,
    },
    ...overrides,
  }
}
