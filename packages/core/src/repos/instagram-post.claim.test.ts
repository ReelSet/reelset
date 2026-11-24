import { describe, expect, it } from 'vitest'
import { fakeDb } from './fake-db'
import { claimNextPost } from './instagram-post.repo'
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
    expect(q).toMatch(/order by coalesce\(requested_by = \$\d+, false\), created_at/)
    expect(q).toMatch(/for update skip locked/)
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
