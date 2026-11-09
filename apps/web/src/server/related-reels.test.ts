import { ItemStatus, RenderStatus } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import { dummyDb } from '@/test/dummy-db'
import { resolveRelatedReels, servedReelsQuery } from './related-reels'

describe('servedReelsQuery', () => {
  const q = servedReelsQuery(dummyDb, ['i1', 'i2'], 7).compile()

  it('only serves what the feed would: rendered, done, video, template at or above minimum', () => {
    expect(q.parameters).toEqual(
      expect.arrayContaining([ItemStatus.rendered, RenderStatus.done, 7]),
    )
    expect(q.sql).toMatch(/"render"."video_key" is not null/)
    expect(q.sql).toMatch(/coalesce\(render.template_version, 0\) >= \$\d+/)
  })
})

describe('resolveRelatedReels', () => {
  it('returns nothing without touching the database when there are no citations', async () => {
    expect(await resolveRelatedReels(dummyDb, [], 'https://media.test')).toEqual([])
  })
})
