import { describe, expect, it } from 'vitest'
import { fakeDb } from './fake-db'
import { claimNextPost, expireStaleAutoPosts, listRecentPostTitles } from './instagram-post.repo'
import { createLogger } from '../lib/logger'

const silentLogger = createLogger({ app: 'test', level: 'silent' })

describe('claimNextPost', () => {
  const claimed = {
    id: 'p1',
    item_id: 'i1',
    video_key: 'v',
    caption: 'c',
    media_pk: null,
    attempts: 1,
  }

  it('holds auto posts for US posting hours and lets admin posts through first', async () => {
    const { db, log } = fakeDb(() => [])
    expect(await claimNextPost(db, silentLogger)).toBeNull()
    const q = log[0]!
    expect(q).toMatch(
      /requested_by is distinct from \$\d+ or extract\(hour from now\(\) at time zone 'America\/New_York'\)::int in \(11, 12, 13, 14, 18, 19, 20, 21, 22\)/,
    )
    expect(q).toMatch(/order by coalesce\(instagram_post\.requested_by = \$\d+, false\),/)
    expect(q).toMatch(/for update skip locked/)
  })

  it('takes the best judged auto post first, then the oldest', async () => {
    const { db, log } = fakeDb(() => [])
    await claimNextPost(db, silentLogger)
    const order = /order by (.*?)\s+limit 1 for update/s.exec(log[0]!)?.[1] ?? ''
    expect(order).toMatch(
      /^coalesce\(instagram_post\.requested_by = \$\d+, false\),\s+coalesce\(\s*\(select d\.score from gate_decision d/,
    )
    expect(order).toMatch(/d\.item_id = instagram_post\.item_id and d\.trigger = 'auto'/)
    expect(order).toMatch(/order by d\.created_at desc, d\.id desc limit 1\)/)
    expect(order).toMatch(
      /select i\.score \* 100 from item i where i\.id = instagram_post\.item_id/,
    )
    expect(order).toMatch(/desc nulls last, created_at$/)
  })

  it('spaces auto posts by the longer gap and admin posts by the short one', async () => {
    const { db, log } = fakeDb(() => [])
    await claimNextPost(db, silentLogger, 10, 25)
    expect(log[0]).toMatch(/case when pick\.auto then \$\d+::int else \$\d+::int end/)
  })

  it('returns the claimed row', async () => {
    const { db } = fakeDb(() => [claimed])
    expect(await claimNextPost(db, silentLogger)).toEqual(claimed)
  })
})

describe('expireStaleAutoPosts', () => {
  it('fails auto posts queued past the limit with the reason and returns the count', async () => {
    const { db, log } = fakeDb((sql) => (sql.startsWith('update') ? [{}, {}] : []))
    expect(await expireStaleAutoPosts(db, silentLogger)).toBe(2)
    expect(log[0]).toMatch(/update "instagram_post" set "status" = \$1, "error" = \$2/)
    expect(log[0]).toMatch(/"status" = \$\d+ and "requested_by" = \$\d+/)
    expect(log[0]).toMatch(/created_at < now\(\) - make_interval\(hours => \$\d+\)/)
  })

  it('binds failed, the stale reason, queued, auto and the 36 hour default', async () => {
    const seen: unknown[][] = []
    const { db } = fakeDb((_sql, params) => {
      seen.push([...params])
      return []
    })
    await expireStaleAutoPosts(db, silentLogger)
    expect(seen[0]).toEqual(
      expect.arrayContaining([
        'failed',
        'Skipped: waited over 36 hours to post, the story is stale.',
        'queued',
        'auto',
        36,
      ]),
    )
  })
})

describe('listRecentPostTitles', () => {
  it('lists the titles of items with a queued, posting or posted post in the window', async () => {
    const { db, log } = fakeDb(() => [{ item_id: 'i1', title: 'T' }])
    expect(await listRecentPostTitles(db, 72)).toEqual([{ item_id: 'i1', title: 'T' }])
    expect(log[0]).toMatch(/p\.status in \('queued', 'posting', 'posted'\)/)
    expect(log[0]).toMatch(/p\.created_at > now\(\) - make_interval\(hours => \$\d+\)/)
  })
})
