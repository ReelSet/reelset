import { describe, expect, it, vi } from 'vitest'
import { persistMentions } from '../src/ingest/persist'
import { refreshRedditScores, settleCutoff } from '../src/ingest/reddit-refresh'
import { sweepStuckRuns } from '../src/ingest/repo'
import { planTasks, runIngest, taskStatusFor } from '../src/ingest/run'
import { ADAPTERS, assertRegistryComplete } from '../src/registry'
import type { NormalizedMention, SourceAdapter } from '../src/types'
import { createFakeDb, type RecordedQuery } from './helpers/fake-db'
import { json, testLog, useFetch } from './helpers/mock-fetch'

const settings = {
  redditSubreddits: ['programming', 'webdev'],
  youtubeSearchQueries: ['rust tutorial'],
  youtubeMaxAgeDays: 7,
  youtubeResultsPerQuery: 10,
  newsFeeds: ['https://a.test/feed', `https://b.test/${'x'.repeat(200)}`],
  papersHfLimit: 50,
  papersArxivCategories: ['cs.AI'],
  papersArxivPerCategory: 10,
  papersMaxAgeDays: 7,
}

const mention = (over: Partial<NormalizedMention> = {}): NormalizedMention => ({
  source: 'hn',
  externalId: '1',
  kind: 'post',
  url: 'https://news.ycombinator.com/item?id=1',
  linkedUrl: 'https://github.com/a/b',
  title: 'Show HN',
  author: 'u',
  body: null,
  score: 100,
  numComments: 10,
  publishedAt: new Date('2026-11-09T08:00:00Z'),
  extraTexts: ['c1'],
  ...over,
})

describe('registry', () => {
  it('has exactly one adapter per source', () => {
    expect(ADAPTERS.map((a) => a.source).sort()).toEqual([
      'github',
      'hn',
      'news',
      'papers',
      'reddit',
      'youtube',
    ])
  })
  it('refuses a registry with a missing or duplicate source', () => {
    expect(() => assertRegistryComplete(ADAPTERS.slice(1))).toThrow(/no adapter registered/)
    expect(() => assertRegistryComplete([...ADAPTERS, ADAPTERS[0]!])).toThrow(/duplicate/)
  })
})

describe('planTasks', () => {
  it('creates one task per scope with sequential positions', () => {
    const tasks = planTasks(ADAPTERS, settings, undefined, testLog)
    expect(tasks.map((t) => `${t.adapter.source}:${t.scope.slice(0, 20)}`)).toEqual([
      'hn:stories',
      'reddit:programming',
      'reddit:webdev',
      'github:trending-new',
      'youtube:search',
      'news:https://a.test/feed',
      'papers:hf-daily',
      'papers:arxiv',
    ])
    expect(tasks.map((t) => t.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('skips scopes longer than the column and honours a source filter', () => {
    expect(planTasks(ADAPTERS, settings, ['news'], testLog)).toHaveLength(1)
  })
  it('plans nothing for youtube when no search queries are configured', () => {
    const tasks = planTasks(
      ADAPTERS,
      { ...settings, youtubeSearchQueries: [] },
      ['youtube'],
      testLog,
    )
    expect(tasks).toEqual([])
  })
})

describe('taskStatusFor', () => {
  it('maps fetch results to ingest_task statuses', () => {
    expect(taskStatusFor(5)).toBe('ok')
    expect(taskStatusFor(0)).toBe('empty')
  })
})

describe('persistMentions', () => {
  function dbForPersist() {
    return createFakeDb((q) => {
      if (q.sql.startsWith('insert into "item"')) {
        return [{ id: 'item-1', canonical_key: 'github:a/b', inserted: true }]
      }
      if (q.sql.startsWith('insert into "mention"')) return [{ inserted: true }]
      if (q.sql.startsWith('select "item_id"')) {
        return [
          {
            item_id: 'item-1',
            source: 'hn',
            score: 150,
            num_comments: 100,
            published_at: new Date(),
          },
        ]
      }
      return undefined
    })
  }

  it('upserts the item by canonical key and the mention by (source, external_id), then rescoring', async () => {
    const fake = dbForPersist()
    const counts = await persistMentions(
      fake.db,
      [mention()],
      testLog,
      new Date('2026-11-09T09:00:00Z'),
    )
    expect(counts).toMatchObject({ fetched: 1, inserted: 1, updated: 0, newItems: 1, skipped: 0 })

    const item = fake.find('insert into "item"')[0]!
    expect(item.params).toContain('github:a/b')
    expect(item.params).toContain('repo')
    expect(item.sql).toContain('on conflict ("canonical_key") do update')
    expect(item.sql).toContain('least(item.published_at, excluded.published_at)')

    const m = fake.find('insert into "mention"')[0]!
    expect(m.sql).toContain('on conflict ("source", "external_id") do update')
    expect(m.params).toContain('item-1')
    expect(m.params.some((p) => typeof p === 'string' && p.includes('"extraTexts":["c1"]'))).toBe(
      true,
    )
    expect(m.sql).toContain("excluded.raw->'extraTexts' = '[]'")

    const rescore = fake.find('update item set score')
    expect(rescore).toHaveLength(1)
    expect(rescore[0]!.params[0]).toEqual(['item-1'])
    expect(Number((rescore[0]!.params[1] as number[])[0])).toBeGreaterThan(0.4)
  })

  it('writes many mentions in one multi-row statement per table, not two round trips each', async () => {
    const mentions = Array.from({ length: 250 }, (_, i) =>
      mention({
        externalId: String(i),
        linkedUrl: null,
        url: `https://news.ycombinator.com/item?id=${i}`,
      }),
    )
    const fake = createFakeDb((q) => {
      if (q.sql.startsWith('insert into "item"')) {
        const keys = q.params.filter((p) => typeof p === 'string' && p.startsWith('hn:'))
        return keys.map((k) => ({ id: `id-${k}`, canonical_key: k, inserted: true }))
      }
      if (q.sql.startsWith('insert into "mention"')) {
        return Array.from({ length: q.params.length / 12 }, () => ({ inserted: true }))
      }
      return undefined
    })
    const counts = await persistMentions(fake.db, mentions, testLog)
    expect(counts).toMatchObject({ fetched: 250, inserted: 250, newItems: 250 })
    expect(fake.find('insert into "item"')).toHaveLength(3)
    expect(fake.find('insert into "mention"')).toHaveLength(3)
  })

  it('collapses duplicate keys inside one chunk so the upsert cannot hit a row twice', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.startsWith('insert into "item"')) {
        return [{ id: 'item-1', canonical_key: 'hn:5', inserted: true }]
      }
      if (q.sql.startsWith('insert into "mention"')) return [{ inserted: true }]
      return undefined
    })
    const dup = mention({ externalId: '5', linkedUrl: null })
    await persistMentions(fake.db, [dup, { ...dup, title: 'again' }], testLog)
    const m = fake.find('insert into "mention"')[0]!
    expect(m.params.filter((p) => p === '5')).toHaveLength(1)
    expect(fake.find('insert into "item"')[0]!.params.filter((p) => p === 'hn:5')).toHaveLength(1)
  })

  it('makes a self post its own discussion item and counts mention updates', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.startsWith('insert into "item"')) {
        return [{ id: 'item-2', canonical_key: 'hn:77', inserted: false }]
      }
      if (q.sql.startsWith('insert into "mention"')) return [{ inserted: false }]
      return undefined
    })
    const counts = await persistMentions(
      fake.db,
      [mention({ externalId: '77', linkedUrl: null })],
      testLog,
    )
    expect(counts).toMatchObject({ inserted: 0, updated: 1, newItems: 0 })
    expect(fake.find('insert into "item"')[0]!.params).toContain('hn:77')
  })

  it('skips mentions that cannot be canonicalised', async () => {
    const fake = dbForPersist()
    const counts = await persistMentions(
      fake.db,
      [mention({ source: 'news', linkedUrl: 'mailto:x@y.z', url: 'mailto:x@y.z' })],
      testLog,
    )
    expect(counts.skipped).toBe(1)
    expect(fake.find('insert into "item"')).toHaveLength(0)
  })
})

describe('sweepStuckRuns', () => {
  it('fails runs with an old heartbeat and their unfinished tasks', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.startsWith('update "ingest_run"')) return [{ id: 'run-1' }]
      if (q.sql.startsWith('update "ingest_task"')) return { rows: [], affected: 2 }
      return undefined
    })
    const cutoff = new Date('2026-11-09T08:00:00Z')
    expect(await sweepStuckRuns(fake.db, cutoff, testLog)).toEqual({ runs: 1, tasks: 2 })
    const run = fake.find('update "ingest_run"')[0]!
    expect(run.sql).toContain('"status" = $1')
    expect(run.sql).toContain('"heartbeat_at" <')
    expect(run.params).toEqual(expect.arrayContaining(['failed', 'running', cutoff]))
    const task = fake.find('update "ingest_task"')[0]!
    expect(task.params).toEqual(expect.arrayContaining(['run-1', 'queued', 'running']))
  })
  it('leaves tasks alone when no run is stuck', async () => {
    const fake = createFakeDb(() => [])
    expect(await sweepStuckRuns(fake.db, new Date(), testLog)).toEqual({ runs: 0, tasks: 0 })
    expect(fake.find('update "ingest_task"')).toHaveLength(0)
  })
})

function fakeAdapter(
  source: SourceAdapter['source'],
  outcome: Awaited<ReturnType<SourceAdapter['fetch']>> | Error,
): SourceAdapter {
  return {
    source,
    scopes: () => [`${source}-scope`],
    fetch: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome
      return outcome
    }),
  }
}

function runDb() {
  return createFakeDb((q: RecordedQuery) => {
    if (q.sql.includes('from "app_setting"')) return []
    if (q.sql.startsWith('insert into "ingest_run"')) return [{ id: 'run-1' }]
    if (q.sql.startsWith('insert into "item"')) return [{ id: 'item-1', inserted: true }]
    if (q.sql.startsWith('insert into "mention"')) return [{ inserted: true }]
    if (q.sql.startsWith('select "item_id"')) return []
    if (q.sql.includes('from "source_watermark"')) return []
    return undefined
  })
}

describe('runIngest', () => {
  it('records a run with per-task rows, saves watermarks and survives one failing source', async () => {
    const fake = runDb()
    const adapters = [
      fakeAdapter('hn', { mentions: [mention()], exhausted: true }),
      fakeAdapter('news', new Error('feed down')),
      fakeAdapter('github', { mentions: [], exhausted: true }),
    ]
    const summary = await runIngest(
      { db: fake.db, log: testLog, env: {}, adapters, now: () => new Date('2026-11-09T09:00:00Z') },
      { mode: 'incremental' },
    )

    expect(summary.runId).toBe('run-1')
    const byScope = Object.fromEntries(summary.tasks.map((t) => [t.scope, t]))
    expect(byScope['hn-scope']).toMatchObject({ status: 'ok', fetched: 1, inserted: 1 })
    expect(byScope['news-scope']).toMatchObject({ status: 'failed', error: 'feed down' })
    expect(byScope['github-scope']).toMatchObject({ status: 'empty' })

    expect(fake.find('insert into "ingest_task"')).toHaveLength(1)
    expect(fake.find('update "ingest_task" set "status" = $1, "fetched"')).toHaveLength(3)
    const wm = fake.find('insert into "source_watermark"')
    expect(wm.map((q) => q.params[0]).sort()).toEqual(['github', 'hn'])

    const finish = fake.find(
      'update "ingest_run" set "status" = $1, "finished_at" = now(), "result"',
    )[0]!
    expect(finish.params[0]).toBe('done')
  })

  it('marks the run failed when every task fails', async () => {
    const fake = runDb()
    await runIngest(
      { db: fake.db, log: testLog, env: {}, adapters: [fakeAdapter('hn', new Error('x'))] },
      { mode: 'incremental' },
    )
    expect(
      fake.find('update "ingest_run" set "status" = $1, "finished_at" = now(), "result"')[0]!
        .params[0],
    ).toBe('failed')
  })

  it('does nothing when there are no tasks', async () => {
    const fake = runDb()
    const summary = await runIngest({ db: fake.db, log: testLog, env: {}, adapters: [] })
    expect(summary.runId).toBeNull()
    expect(fake.find('insert into "ingest_run"')).toHaveLength(0)
  })

  it('skips backfill tasks whose watermark is already complete', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.includes('from "app_setting"')) return []
      if (q.sql.startsWith('insert into "ingest_run"')) return [{ id: 'run-2' }]
      if (q.sql.includes('from "source_watermark"')) {
        return [
          {
            source: 'hn',
            scope: 'hn-scope',
            lane: 'default',
            newest_at: null,
            oldest_at: null,
            next_token: null,
            backfill_complete: true,
          },
        ]
      }
      return undefined
    })
    const adapter = fakeAdapter('hn', { mentions: [mention()], exhausted: true })
    const summary = await runIngest(
      { db: fake.db, log: testLog, env: {}, adapters: [adapter] },
      { mode: 'backfill' },
    )
    expect(adapter.fetch).not.toHaveBeenCalled()
    expect(summary.tasks[0]).toMatchObject({ status: 'empty', fetched: 0 })
  })
})

describe('reddit score refresh', () => {
  it('cuts off at the settle window', () => {
    expect(settleCutoff(new Date('2026-11-09T12:00:00Z')).toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    )
  })

  it('hydrates due posts, updates scores and marks missing posts scored', async () => {
    const fake = createFakeDb((q) => {
      if (q.sql.startsWith('select "item_id"')) return []
      if (q.sql.includes('from "mention"')) {
        return [
          { id: 'm1', item_id: 'i1', external_id: 'abc' },
          { id: 'm2', item_id: 'i2', external_id: 'gone' },
        ]
      }
      return undefined
    })
    const { calls } = useFetch(
      (url) =>
        url.includes('/api/posts/ids')
          ? json({ data: [{ id: 'abc', created_utc: 1, score: 420, num_comments: 5 }] })
          : undefined,
      (url) =>
        url.includes('/api/comments/tree')
          ? json({
              data: [
                { kind: 't1', data: { id: 'c', created_utc: 1, body: 'Top comment', score: 3 } },
              ],
            })
          : undefined,
    )
    const n = await refreshRedditScores(
      fake.db,
      testLog,
      new Date('2026-11-09T12:00:00Z'),
      performance.now() + 10_000,
    )
    expect(n).toBe(2)
    expect(calls[0]).toContain('ids=abc%2Cgone')
    const updates = fake.find('update "mention" set')
    expect(updates).toHaveLength(2)
    expect(updates[0]!.params).toContain(420)
    expect(updates[0]!.params.some((p) => typeof p === 'string' && p.includes('Top comment'))).toBe(
      true,
    )
  })

  it('does nothing when no mentions are due', async () => {
    const fake = createFakeDb(() => [])
    const { calls } = useFetch()
    expect(await refreshRedditScores(fake.db, testLog, new Date(), performance.now() + 1000)).toBe(
      0,
    )
    expect(calls).toHaveLength(0)
  })
})
