import { describe, expect, it } from 'vitest'
import { filtersToParams, parseRecentFilters } from './recent-filters'

const SOURCES = ['hn', 'github']

describe('parseRecentFilters', () => {
  it('defaults to all statuses in the last 24h', () => {
    const f = parseRecentFilters({}, SOURCES)
    expect(f).toMatchObject({
      group: 'all',
      statuses: [],
      source: null,
      range: '24h',
      sinceMs: 86_400_000,
      q: null,
    })
  })

  it('maps the failed view to the failed status and honours a known source', () => {
    const f = parseRecentFilters(
      { view: 'failed', source: 'hn', range: '7d', q: ' widget ' },
      SOURCES,
    )
    expect(f).toMatchObject({
      group: 'failed',
      statuses: ['failed'],
      source: 'hn',
      range: '7d',
      q: 'widget',
    })
  })

  it('ignores unknown values instead of trusting the query string', () => {
    const f = parseRecentFilters(
      { view: 'drop table', source: 'myspace', range: 'forever' },
      SOURCES,
    )
    expect(f).toMatchObject({ group: 'all', source: null, range: '24h' })
  })

  it('treats the all-time range as unbounded', () => {
    expect(parseRecentFilters({ range: 'all' }, SOURCES).sinceMs).toBeNull()
  })
})

describe('filtersToParams', () => {
  it('omits defaults so urls stay short', () => {
    expect(filtersToParams(parseRecentFilters({}, SOURCES))).toEqual({
      view: undefined,
      source: undefined,
      range: undefined,
      q: undefined,
    })
    expect(filtersToParams(parseRecentFilters({ view: 'failed', q: 'x' }, SOURCES)).view).toBe(
      'failed',
    )
  })
})
