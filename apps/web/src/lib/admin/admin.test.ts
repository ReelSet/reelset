import { SETTINGS } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { fmtBytes, fmtDate, fmtMs, fmtPct, truncate } from './format'
import { parseAlertLastSent, successRate, transcriptStats, YOUTUBE_ALERT_KEY } from './health'
import { pageHref, parsePage, sliceWithMore } from './pagination'
import {
  idSchema,
  itemRetrySchema,
  parseFlash,
  RETRY_STAGES,
  safeAdminPath,
  suggestRetryStage,
  withFlash,
} from './retry'
import { directorSettingFields } from './director'
import { formatSettingInput, parseSettingInput, settingFields } from './settings-form'
import { capUsage, lastDays, pivotSpend, splitSpend } from './spend'

describe('pagination', () => {
  it('parses page numbers defensively', () => {
    expect(parsePage(undefined, 25)).toEqual({ page: 1, pageSize: 25, offset: 0 })
    expect(parsePage('3', 25).offset).toBe(50)
    expect(parsePage('-4', 25).page).toBe(1)
    expect(parsePage('abc', 25).page).toBe(1)
    expect(parsePage(['2', '9'], 10).page).toBe(2)
    expect(parsePage('99999999', 10).page).toBe(10_000)
  })

  it('slices the extra probe row', () => {
    expect(sliceWithMore([1, 2, 3], 2)).toEqual({ rows: [1, 2], hasMore: true })
    expect(sliceWithMore([1, 2], 2)).toEqual({ rows: [1, 2], hasMore: false })
  })

  it('builds hrefs keeping filters and omitting page 1', () => {
    expect(pageHref('/admin/renders', { status: 'failed' }, 1)).toBe('/admin/renders?status=failed')
    expect(pageHref('/admin/renders', { status: undefined }, 3)).toBe('/admin/renders?page=3')
    expect(pageHref('/admin/ask', {}, 1)).toBe('/admin/ask')
  })
})

describe('retry helpers', () => {
  it('only allows pipeline stages as retry targets', () => {
    const id = '0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
    expect(itemRetrySchema.safeParse({ itemId: id, stage: 'embedded' }).success).toBe(true)
    expect(itemRetrySchema.safeParse({ itemId: id, stage: 'rendered' }).success).toBe(false)
    expect(itemRetrySchema.safeParse({ itemId: id, stage: 'voiced' }).success).toBe(false)
    expect(RETRY_STAGES).not.toContain('voiced')
    expect(itemRetrySchema.safeParse({ itemId: id, stage: 'failed' }).success).toBe(false)
    expect(itemRetrySchema.safeParse({ itemId: 'nope', stage: 'found' }).success).toBe(false)
    expect(idSchema.safeParse({ id: 'x' }).success).toBe(false)
  })

  it('suggests the last successful stage, else found', () => {
    expect(suggestRetryStage('summarized')).toBe('summarized')
    expect(suggestRetryStage('voiced')).toBe('embedded')
    expect(suggestRetryStage('rendered')).toBe('found')
    expect(suggestRetryStage(null)).toBe('found')
  })

  it('rejects redirect targets outside /admin', () => {
    expect(safeAdminPath('/admin/renders?status=failed&page=2')).toBe(
      '/admin/renders?status=failed&page=2',
    )
    expect(safeAdminPath('https://evil.test')).toBe('/admin')
    expect(safeAdminPath('//evil.test')).toBe('/admin')
    expect(safeAdminPath('/admin/../x')).toBe('/admin')
    expect(safeAdminPath(undefined)).toBe('/admin')
  })

  it('round-trips flash messages', () => {
    const url = withFlash('/admin?item=abc', 'error', 'item moved: not failed')
    const flash = new URL(url, 'http://x').searchParams.get('flash')
    expect(new URL(url, 'http://x').searchParams.get('item')).toBe('abc')
    expect(parseFlash(flash ?? undefined)).toEqual({
      kind: 'error',
      message: 'item moved: not failed',
    })
    expect(parseFlash('weird')).toBeNull()
    expect(parseFlash('bad:thing')).toBeNull()
  })
})

describe('settings form', () => {
  const field = (name: keyof typeof SETTINGS) => {
    const found = settingFields().find((f) => f.name === name)
    if (!found) throw new Error('missing field')
    return found
  }

  it('covers every SETTINGS entry between this page and the director page', () => {
    expect([...settingFields(), ...directorSettingFields()].map((f) => f.def.key).sort()).toEqual(
      Object.values(SETTINGS)
        .map((s) => s.key)
        .sort(),
    )
  })

  it('validates numbers with the core schema', () => {
    expect(parseSettingInput(field('dailyReelCap'), '150')).toEqual({ ok: true, value: 150 })
    expect(parseSettingInput(field('dailyReelCap'), '1.5').ok).toBe(false)
    expect(parseSettingInput(field('dailyReelCap'), '-3').ok).toBe(false)
    expect(parseSettingInput(field('dailyReelCap'), '').ok).toBe(false)
    expect(parseSettingInput(field('minItemScore'), '1.2').ok).toBe(false)
    expect(parseSettingInput(field('minItemScore'), '0.4')).toEqual({ ok: true, value: 0.4 })
    expect(parseSettingInput(field('dailyReelCap'), 42).ok).toBe(false)
  })

  it('parses lists from lines or commas and validates urls', () => {
    expect(parseSettingInput(field('redditSubreddits'), 'a\n b ,c\n\n')).toEqual({
      ok: true,
      value: ['a', 'b', 'c'],
    })
    expect(parseSettingInput(field('youtubeSearchQueries'), '')).toEqual({ ok: true, value: [] })
    expect(parseSettingInput(field('youtubeSearchQueries'), 'rust, async\n\n  llm evals ')).toEqual(
      {
        ok: true,
        value: ['rust, async', 'llm evals'],
      },
    )
    expect(parseSettingInput(field('youtubeSearchQueries'), 'x').ok).toBe(false)
    expect(parseSettingInput(field('youtubeMaxAgeDays'), '7')).toEqual({ ok: true, value: 7 })
    expect(parseSettingInput(field('youtubeMaxAgeDays'), '99').ok).toBe(false)
    expect(parseSettingInput(field('newsFeeds'), 'not a url').ok).toBe(false)
    expect(parseSettingInput(field('newsFeeds'), 'https://a.dev/feed')).toEqual({
      ok: true,
      value: ['https://a.dev/feed'],
    })
  })

  it('renders enum settings as selects with the options from the core schema', () => {
    expect(field('scriptModel')).toMatchObject({
      kind: 'enum',
      options: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    })
    expect(field('scriptEffort')).toMatchObject({
      kind: 'enum',
      options: ['low', 'medium', 'high'],
    })
    expect(field('ttsProvider')).toMatchObject({
      kind: 'enum',
      options: ['edge', 'aura2', 'kokoro'],
    })
    expect(field('imageVetModel').kind).toBe('enum')
    expect(field('askModel').kind).toBe('enum')
    expect(field('dailyReelCap').kind).toBe('number')
  })

  it('renders boolean settings as true/false and parses only those words', () => {
    expect(field('instagramAutoPost').kind).toBe('boolean')
    expect(field('renderUpgradeEnabled').kind).toBe('boolean')
    expect(parseSettingInput(field('instagramAutoPost'), ' false ')).toEqual({
      ok: true,
      value: false,
    })
    expect(parseSettingInput(field('instagramAutoPost'), 'true')).toEqual({ ok: true, value: true })
    expect(parseSettingInput(field('instagramAutoPost'), 'yes').ok).toBe(false)
    expect(formatSettingInput('boolean', true)).toBe('true')
  })

  it('validates enum values against the schema', () => {
    expect(parseSettingInput(field('scriptModel'), ' claude-opus-5-5 ')).toEqual({
      ok: true,
      value: 'claude-opus-5-5',
    })
    expect(parseSettingInput(field('askModel'), 'claude-sonnet-5-5')).toEqual({
      ok: true,
      value: 'claude-sonnet-5-5',
    })
    expect(parseSettingInput(field('scriptModel'), 'gpt-5').ok).toBe(false)
    expect(parseSettingInput(field('scriptEffort'), 'max').ok).toBe(false)
    expect(parseSettingInput(field('ttsProvider'), 'aura2')).toEqual({ ok: true, value: 'aura2' })
    expect(parseSettingInput(field('ttsProvider'), '').ok).toBe(false)
  })

  it('hints model fields with prices from the core table', () => {
    expect(field('scriptModel').hint).toContain('haiku $0.10/$0.50 (1x)')
    expect(field('askModel').hint).toContain('sonnet $2/$10 (20x)')
    expect(field('imageVetModel').hint).toContain('opus $4/$20 (40x)')
  })

  it('formats values back into inputs', () => {
    expect(formatSettingInput('list', ['a', 'b'])).toBe('a\nb')
    expect(formatSettingInput('number', 200)).toBe('200')
    expect(formatSettingInput('enum', 'claude-haiku-5-5')).toBe('claude-haiku-5-5')
  })
})

describe('spend', () => {
  it('lists days newest first in UTC', () => {
    expect(lastDays(3, new Date('2026-11-01T23:59:00Z'))).toEqual([
      '2026-11-01',
      '2026-10-31',
      '2026-10-30',
    ])
  })

  it('pivots rows per day and category, filling empty days', () => {
    const days = ['2026-11-02', '2026-11-01']
    const out = pivotSpend(
      [
        { day: '2026-11-02', category: 'llm', costUsd: 1.5, units: 10 },
        { day: '2026-11-02', category: 'llm', costUsd: 0.5, units: 5 },
        { day: '2026-11-02', category: 'tts', costUsd: 0.25, units: 1 },
      ],
      days,
    )
    expect(out[0]).toEqual({ day: '2026-11-02', byCategory: { llm: 2, tts: 0.25 }, totalUsd: 2.25 })
    expect(out[1]).toEqual({ day: '2026-11-01', byCategory: {}, totalUsd: 0 })
  })

  it('splits pipeline spend from Ask spend', () => {
    expect(
      splitSpend({ llm: 1, embedding: 0.5, tts: 0.25, render: 0.25, ask: 3, storage: 9 }),
    ).toEqual({
      pipelineUsd: 2,
      askUsd: 3,
    })
    expect(splitSpend({})).toEqual({ pipelineUsd: 0, askUsd: 0 })
  })

  it('reports cap usage', () => {
    expect(capUsage(5, 10)).toEqual({ fraction: 0.5, over: false })
    expect(capUsage(10, 10).over).toBe(true)
    expect(capUsage(1, 0)).toEqual({ fraction: 0, over: true })
  })
})

describe('health', () => {
  it('computes rates', () => {
    expect(successRate(1, 4)).toBe(0.25)
    expect(successRate(0, 0)).toBeNull()
  })

  it('reads the youtube alert key and parses its timestamp', () => {
    expect(YOUTUBE_ALERT_KEY).toBe('alert_last_sent:youtube_search_failing')
    expect(parseAlertLastSent('2026-11-09T10:00:00Z')).toBe('2026-11-09T10:00:00.000Z')
    expect(parseAlertLastSent('junk')).toBeNull()
    expect(parseAlertLastSent(undefined)).toBeNull()
  })

  it('uses the last 20 transcript outcomes and flags thin data', () => {
    const outcomes = [...Array(5).fill('ok'), ...Array(5).fill('unavailable')] as (
      'ok' | 'unavailable'
    )[]
    expect(transcriptStats(outcomes)).toEqual({ attempts: 10, rate: 0.5, enoughData: true })
    expect(transcriptStats(outcomes.slice(0, 4)).enoughData).toBe(false)
    const long = Array(30).fill('unavailable') as 'unavailable'[]
    expect(transcriptStats(long).attempts).toBe(20)
  })
})

describe('format', () => {
  it('formats values', () => {
    expect(fmtDate(new Date('2026-11-09T01:02:03.456Z'))).toBe('2026-11-09 01:02:03')
    expect(fmtDate(null)).toBe('-')
    expect(fmtMs(850)).toBe('850 ms')
    expect(fmtMs(1500)).toBe('1.5 s')
    expect(fmtMs(125_000)).toBe('2m 5s')
    expect(fmtBytes(2_621_440)).toBe('2.5 MB')
    expect(fmtPct(0.456)).toBe('46%')
    expect(truncate('abcdef', 4)).toBe('abc…')
  })
})
