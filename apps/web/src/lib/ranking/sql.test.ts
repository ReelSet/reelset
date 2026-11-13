import { describe, expect, it } from 'vitest'
import { ItemStatus, RenderStatus, type Database } from '@reelset/core'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely'
import { orderRows, toRankedItem } from './index'
import { candidatesQuery, hydrateQuery, tasteSignalsQuery, type FeedRow } from './sql'

const db = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new PostgresIntrospector(k),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
}) as unknown as Database

describe('candidatesQuery topic filter', () => {
  const base = { profileId: null, asOf: '2026-11-09T12:00:00.000Z', poolSize: 10, minTemplate: 5 }

  it('restricts the pool to items tagged with any topic label', () => {
    const q = candidatesQuery({ ...base, labels: ['Rust', 'rust-lang'] }).compile(db)
    expect(q.sql).toMatch(/i\.topics && \$\d+::text\[\]/)
    expect(q.parameters).toContainEqual(['Rust', 'rust-lang'])
  })

  it('adds no topic filter without labels', () => {
    expect(candidatesQuery(base).compile(db).sql).not.toMatch(/i\.topics &&/)
    expect(candidatesQuery({ ...base, labels: [] }).compile(db).sql).not.toMatch(/i\.topics &&/)
  })
})

describe('candidatesQuery source preference', () => {
  const base = {
    profileId: 'p-1',
    asOf: '2026-11-09T12:00:00.000Z',
    poolSize: 10,
    minTemplate: 5,
  }

  it('adds no mention filter when every source is enabled', () => {
    const q = candidatesQuery(base).compile(db)
    expect(q.sql).not.toMatch(/from mention/)
    expect(candidatesQuery({ ...base, sources: [] }).compile(db).sql).not.toMatch(/from mention/)
  })

  it('restricts to items mentioned by an enabled source', () => {
    const q = candidatesQuery({ ...base, sources: ['hn', 'papers'] }).compile(db)
    expect(q.sql).toMatch(/from mention m/)
    expect(q.sql).toMatch(/m\.source::text = any\(\$\d+::text\[\]\)/)
    expect(q.parameters).toContainEqual(['hn', 'papers'])
  })
})

describe('candidatesQuery', () => {
  const q = candidatesQuery({
    profileId: 'p-1',
    asOf: '2026-11-09T12:00:00.000Z',
    poolSize: 400,
    minTemplate: 5,
  }).compile(db)

  it('only offers visible items: rendered with a done render that has a video key', () => {
    expect(q.parameters).toContain(ItemStatus.rendered)
    expect(q.parameters).toContain(RenderStatus.done)
    expect(q.sql).toMatch(/r\.video_key is not null/)
  })

  it('hides items without a done render at or above the minimum template', () => {
    expect(q.sql).toMatch(/coalesce\(r\.template_version, 0\) >= \$\d+/)
    expect(q.parameters).toContain(5)
  })

  it('computes cosine similarity against the profile taste vector', () => {
    expect(q.sql).toMatch(/i\.embedding <=> p\.taste_embedding/)
    expect(q.parameters).toContain('p-1')
  })

  it('pins the pool to asOf and bounds its size', () => {
    expect(q.sql).toMatch(/<= \$\d+::timestamptz/)
    expect(q.parameters).toContain('2026-11-09T12:00:00.000Z')
    expect(q.parameters).toContain(400)
  })

  it('binds a null profile for anonymous viewers', () => {
    const anon = candidatesQuery({
      profileId: null,
      asOf: '2026-11-09T12:00:00.000Z',
      poolSize: 5,
      minTemplate: 0,
    }).compile(db)
    expect(anon.parameters).toContain(null)
  })
})

describe('hydrateQuery', () => {
  it('looks up the latest done render laterally and aggregates mentions', () => {
    const q = hydrateQuery(db, { profileId: null, itemIds: ['a', 'b'], minTemplate: 5 }).compile()
    expect(q.sql).toMatch(/lateral/i)
    expect(q.sql).toMatch(/"render"\."video_key" is not null/)
    expect(q.sql).toMatch(/from "mention"/)
    expect(q.parameters).toEqual(expect.arrayContaining(['a', 'b', ItemStatus.rendered]))
  })

  it('picks the newest template first, then the latest finish, within the minimum', () => {
    const q = hydrateQuery(db, { profileId: null, itemIds: ['a'], minTemplate: 5 }).compile()
    expect(q.sql).toMatch(
      /coalesce\(render\.template_version, 0\) >= \$\d+[\s\S]*order by coalesce\(render\.template_version, 0\) desc, render\.finished_at desc nulls last, "render"\."created_at" desc limit/,
    )
    expect(q.parameters).toContain(5)
  })

  it('checks likes for the viewer only when logged in', () => {
    const anon = hydrateQuery(db, { profileId: null, itemIds: ['a'], minTemplate: 0 }).compile()
    const user = hydrateQuery(db, { profileId: 'p-1', itemIds: ['a'], minTemplate: 0 }).compile()
    expect(anon.parameters).not.toContain('p-1')
    expect(user.parameters).toContain('p-1')
  })
})

describe('tasteSignalsQuery', () => {
  it('reads likes at weight 1 and reel_complete >= 0.8 at weight 0.5', () => {
    const q = tasteSignalsQuery('p-1').compile(db)
    expect(q.sql).toMatch(/from "like"/)
    expect(q.sql).toMatch(/distinct on \(e\.item_id\)/)
    expect(q.parameters).toEqual(expect.arrayContaining([1, 0.5, 0.8, 'reel_complete', 'p-1']))
  })
})

describe('toRankedItem / orderRows', () => {
  const row = {
    id: 'i1',
    title: 't',
    tldr: null,
    topics: ['ai'],
    kind: 'repo',
    canonical_url: 'https://x.dev',
    score: 0.5,
    published_at: new Date('2026-11-07T00:00:00Z'),
    video_key: 'reels/i1/k.mp4',
    poster_key: null,
    video_duration_ms: 1000,
    mentions: [],
    like_count: '3',
    liked: true,
  } as unknown as FeedRow

  it('maps a visible row', () => {
    expect(toRankedItem(row)).toMatchObject({
      id: 'i1',
      likeCount: 3,
      liked: true,
      videoKey: 'reels/i1/k.mp4',
    })
  })

  it('carries render credits into the item, null when absent', () => {
    expect(toRankedItem(row)?.credits).toBeNull()
    const credited = {
      ...row,
      credits: [
        {
          kind: 'stock',
          provider: 'pexels',
          creator: 'Ann',
          url: 'https://www.pexels.com/video/1/',
        },
      ],
    } as unknown as FeedRow
    expect(toRankedItem(credited)?.credits).toEqual({
      stock: [{ creator: 'Ann', url: 'https://www.pexels.com/video/1/' }],
      demo: null,
    })
  })

  it('selects credits from the latest done render', () => {
    const sqlText = hydrateQuery(db, {
      profileId: null,
      itemIds: ['i1'],
      minTemplate: 0,
    }).compile().sql
    expect(sqlText).toContain('"render"."credits"')
    expect(sqlText).toContain('"r"."credits"')
  })

  it('drops a row without a video key', () => {
    expect(toRankedItem({ ...row, video_key: null } as FeedRow)).toBeNull()
  })

  it('restores rank order and skips ids that vanished', () => {
    const b = { ...row, id: 'b' } as FeedRow
    expect(orderRows([row, b], ['b', 'gone', 'i1']).map((r) => r.id)).toEqual(['b', 'i1'])
  })
})

describe('candidatesQuery source scope', () => {
  const base = { profileId: null, asOf: '2026-11-09T12:00:00.000Z', poolSize: 10, minTemplate: 5 }

  it('combines a source with topic labels', () => {
    const q = candidatesQuery({ ...base, sources: ['hn'], labels: ['ai'] }).compile(db)
    expect(q.sql).toMatch(/m\.source::text = any/)
    expect(q.sql).toMatch(/i\.topics &&/)
  })
})
