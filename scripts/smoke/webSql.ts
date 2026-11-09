import pg from 'pg'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { randomUUID } from 'node:crypto'
import { createLogger, toVectorLiteral, EMBEDDING_DIMENSIONS, SETTINGS, ItemStatus, RenderStatus, type Database } from '@reelset/core'

const log = createLogger({ app: 'smoke', level: 'warn' })
const results: { name: string; ok: boolean; detail: string }[] = []
async function step<T>(name: string, fn: () => Promise<T>, show?: (v: T) => string): Promise<T | undefined> {
  const t = Date.now()
  try {
    const v = await fn()
    results.push({ name, ok: true, detail: `${show ? show(v) : 'ok'} (${Date.now() - t}ms)` })
    return v
  } catch (e: any) {
    results.push({ name, ok: false, detail: `${e?.name}: ${e?.message}${e?.code ? ' code=' + e.code : ''}${e?.where ? ' where=' + e.where : ''}` })
    return undefined
  }
}

// one real connection, wrapped in an outer transaction that is always rolled back.
// Kysely begin/commit/rollback issued by nested db.transaction() become savepoints.
const client = new pg.Client({ connectionString: process.env.DIRECT_URL })
await client.connect()
await client.query('begin')
let depth = 0
const proxy: any = {
  async query(text: any, params?: any) {
    const t = typeof text === 'string' ? text.trim().toLowerCase() : ''
    if (t.startsWith('begin') || t.startsWith('start transaction')) { depth++; return client.query(`savepoint sp_${depth}`) }
    if (t === 'commit') { const r = await client.query(`release savepoint sp_${depth}`); depth--; return r }
    if (t === 'rollback') { const r = await client.query(`rollback to savepoint sp_${depth}`); depth--; return r }
    return client.query(text, params)
  },
  release() {},
}
const fakePool: any = { connect: async () => proxy, end: async () => {}, on() {} }
const db: Database = new Kysely<any>({ dialect: new PostgresDialect({ pool: fakePool }) }) as any
;(globalThis as any).__reelsetDb = { db, close: async () => {} }

function vec(seed: number, dims = EMBEDDING_DIMENSIONS) {
  const v: number[] = []
  let x = seed
  for (let i = 0; i < dims; i++) { x = (x * 1103515245 + 12345) % 2147483648; v.push(x / 2147483648 - 0.5) }
  const n = Math.sqrt(v.reduce((s, a) => s + a * a, 0))
  return v.map((a) => a / n)
}

const profileId = randomUUID(), adminId = randomUUID()
const itemIds: string[] = []
const mentionIds: string[] = []
try {
  // fixtures
  await step('fixtures: profiles, 4 rendered items + renders + mentions + chunks', async () => {
    await sql`insert into profile (id, role, topics) values (${profileId}::uuid, 'user', ${['ai', 'databases']}::text[]), (${adminId}::uuid, 'admin', '{}')`.execute(db)
    for (let i = 0; i < 4; i++) {
      const id = randomUUID()
      itemIds.push(id)
      await sql`insert into item (id, canonical_key, canonical_url, kind, title, topics, status, score, tldr, published_at, rendered_at, embedding)
        values (${id}::uuid, ${'smoke:' + id}, ${'https://example.com/' + id}, 'article', ${'Smoke item ' + i}, ${i % 2 ? ['ai'] : ['databases']}::text[], 'rendered', ${0.4 + i * 0.1}, 'tldr', now() - ${i} * interval '1 hour', now() - interval '1 minute', ${toVectorLiteral(vec(i + 1))}::vector)`.execute(db)
      await sql`insert into render (item_id, render_key, status, video_key, poster_key, bytes, video_duration_ms, finished_at)
        values (${id}::uuid, ${'smoke-' + id}, 'done', ${'reels/' + id + '/k.mp4'}, ${'reels/' + id + '/k.jpg'}, 1000, 30000, now())`.execute(db)
      const m = await sql<{ id: string }>`insert into mention (item_id, source, kind, external_id, url, title, score, published_at) values (${id}::uuid, 'hn', 'post', ${'smoke-' + id}, ${'https://example.com/' + id}, 'm', ${10 * i}, now()) returning id`.execute(db)
      mentionIds.push(m.rows[0]!.id)
    }
    // an unrendered/ pending-video item that must not show
    const hid = randomUUID(); itemIds.push(hid)
    await sql`insert into item (id, canonical_key, canonical_url, kind, title, status, published_at, embedding) values (${hid}::uuid, ${'smoke:' + hid}, 'https://example.com/h', 'article', 'hidden', 'rendered', now(), ${toVectorLiteral(vec(99))}::vector)`.execute(db)
    await sql`insert into render (item_id, render_key, status, video_key) values (${hid}::uuid, ${'smoke-' + hid}, 'done', null)`.execute(db)
    return 'ok'
  })

  const { rankFeed, getFeedItem } = await import('../../apps/web/src/lib/ranking')
  const sqlmod = await import('../../apps/web/src/lib/ranking/sql')
  const feedCold = await step('rankFeed cold start (anon)', () => rankFeed(db, { profileId: null, cursor: null, limit: 10, log }), (f: any) => `items=${f.items.length} next=${f.nextCursor} hiddenLeaked=${f.items.some((i: any) => i.title === 'hidden')} sample=${JSON.stringify(f.items[0] && { id: f.items[0].id.slice(0, 8), videoKey: f.items[0].videoKey, mentions: f.items[0].mentions.length, liked: f.items[0].liked, likeCount: f.items[0].likeCount })}`)
  await step('rankFeed pagination cursor', async () => {
    const p1: any = await rankFeed(db, { profileId: null, cursor: null, limit: 2, log })
    const p2: any = await rankFeed(db, { profileId: null, cursor: p1.nextCursor, limit: 2, log })
    const ids = [...p1.items, ...p2.items].map((i: any) => i.id)
    if (new Set(ids).size !== ids.length) throw new Error('duplicate across pages')
    return `p1=${p1.items.length} p2=${p2.items.length} next2=${p2.nextCursor}`
  })
  await step('setLike insert (profile)', async () => {
    const { setLike } = await import('../../apps/web/src/server/likes')
    const a = await setLike(db, { profileId, itemId: itemIds[0]!, liked: true }, log)
    const b = await setLike(db, { profileId, itemId: itemIds[0]!, liked: true }, log)
    const c = await setLike(db, { profileId, itemId: itemIds[1]!, liked: true }, log)
    const hiddenTarget = await setLike(db, { profileId, itemId: randomUUID(), liked: true }, log)
    return JSON.stringify({ a, b, c, hiddenTarget })
  })
  await step('events insert (feed_view, reel_complete with meta)', async () => {
    await db.insertInto('event' as any).values([
      { profile_id: profileId, session_id: 's1', name: 'reel_complete', item_id: itemIds[2], meta: JSON.stringify({ watchRatio: 0.95 }) },
      { profile_id: profileId, session_id: 's1', name: 'feed_view', item_id: null, meta: null },
      { profile_id: null, session_id: 's2', name: 'item_open', item_id: itemIds[1], meta: JSON.stringify({ x: 1 }) },
    ]).execute()
    return 'ok'
  })
  await step('tasteSignalsQuery + recomputeTaste', async () => {
    const { recomputeTaste } = await import('../../apps/web/src/server/taste')
    const sig = await sqlmod.loadTasteSignals(db, profileId)
    const r = await recomputeTaste(db, profileId, log)
    const row = await sql<any>`select signal_count, vector_dims(taste_embedding) d from profile where id=${profileId}::uuid`.execute(db)
    return `signals=${sig.length} result=${JSON.stringify(r)} row=${JSON.stringify(row.rows[0])}`
  })
  await step('rankFeed with taste vector', async () => {
    const f: any = await rankFeed(db, { profileId, cursor: null, limit: 10, log })
    const cand = await sqlmod.loadCandidates(db, { profileId, asOf: new Date().toISOString() })
    return `items=${f.items.length} liked=${f.items.filter((i: any) => i.liked).length} sims=${cand.map((c) => c.similarity?.toFixed(3)).join(',')} order=${f.items.map((i: any) => i.title).join('|')}`
  })
  await step('getFeedItem single', async () => {
    const it: any = await getFeedItem(db, { itemId: itemIds[0]!, profileId, log })
    return `found=${!!it} liked=${it?.liked} likeCount=${it?.likeCount}`
  })
  await step('setLike unlike', async () => {
    const { setLike } = await import('../../apps/web/src/server/likes')
    return JSON.stringify(await setLike(db, { profileId, itemId: itemIds[0]!, liked: false }, log))
  })

  // Ask retrieval with a real question embedding
  process.env.MEDIA_PUBLIC_BASE_URL ||= 'https://media.reelset.app'
  const { createAskDeps } = await import('../../apps/web/src/server/ask-deps')
  const deps = createAskDeps(log)
  const qvec = await step('Ask: embedQuestion (real Gemini)', () => deps.embed('What is new in open source AI models this week?'), (v: number[]) => `dims=${v.length}`)
  if (qvec) {
    await step('Ask: retrieve (pgvector <=>, joins)', async () => {
      await sql`insert into evidence_chunk (item_id, mention_id, chunk_index, text, embedding) values (${itemIds[0]}::uuid, ${mentionIds[0]}::uuid, 0, 'fixture chunk', ${toVectorLiteral(qvec)}::vector)`.execute(db)
      const rows = await deps.retrieve(qvec)
      return `rows=${rows.length} top=${JSON.stringify(rows[0] && { text: rows[0].text, sim: rows[0].similarity.toFixed(4), url: rows[0].url, title: rows[0].title })}`
    })
  }
  await step('Ask: limits/spentTodayUsd', async () => `${JSON.stringify(await deps.limits())} spent=${await deps.spentTodayUsd()}`)
  await step('Ask: reserveAsk (advisory lock + insert) x2', async () => {
    const a = await deps.reserveAsk({ profileId, question: 'q one', normalized: 'q one', hourlyLimit: 1 })
    const b = await deps.reserveAsk({ profileId, question: 'q two', normalized: 'q two', hourlyLimit: 1 })
    if (!a) throw new Error('first reserve was null')
    if (b !== null) throw new Error('second reserve should be limited')
    await deps.completeQuery(a, { profileId, question: 'q one', normalized: 'q one', outcome: 'answered' as any, answer: 'ans', citations: [{ n: 1 }] as any, latencyMs: 5, inputTokens: 1, outputTokens: 2 })
    const cached = await deps.findCached('q one')
    return `reservation=${a.slice(0, 8)} limited=${b === null} cached=${JSON.stringify(cached)}`
  })
  await step('Ask: logQuery + recordSpend(ask)', async () => {
    await deps.logQuery({ profileId, question: 'q3', normalized: 'q3', outcome: 'no_evidence' as any, answer: null, citations: null, latencyMs: 3, inputTokens: null, outputTokens: null })
    await deps.recordSpend('llm' as any, 100, 0.001)
    await deps.recordSpend('embedding' as any, 10, 0.0001)
    return `spent=${await deps.spentTodayUsd()}`
  })

  // admin
  // fixtures for failed item + failed render + failed task
  const failedItem = randomUUID(), failedRenderItem = randomUUID()
  const failedRender = randomUUID()
  await step('admin fixtures', async () => {
    for (const id of [failedItem, failedRenderItem]) {
      await sql`insert into item (id, canonical_key, canonical_url, kind, title, status, published_at, attempts, last_error, queued_at) values (${id}::uuid, ${'smoke:' + id}, 'https://example.com/f', 'article', 'failed one', 'failed', now(), 3, 'boom', now() - interval '2 hours')`.execute(db)
      await sql`insert into item_event (item_id, stage, outcome) values (${id}::uuid, 'summarized', 'ok'), (${id}::uuid, 'failed', 'failed')`.execute(db)
    }
    await sql`insert into render (id, item_id, render_key, status, error) values (${failedRender}::uuid, ${failedRenderItem}::uuid, 'smoke-failed-render', 'failed', 'tts_error')`.execute(db)
    await sql`insert into item (id, canonical_key, canonical_url, kind, title, status, published_at, queued_at) values (${randomUUID()}::uuid, ${'smoke:stuck:' + randomUUID()}, 'https://example.com/s', 'article', 'stuck', 'embedded', now(), now() - interval '2 hours')`.execute(db)
    return 'ok'
  })
  const q = await import('../../apps/web/src/server/admin/queries')
  const page = { page: 1, pageSize: 20, offset: 0 }
  const brief = (v: any) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? String(x) : x))?.slice(0, 160)
  await step('admin statusCounts', () => q.statusCounts(db), brief)
  await step('admin stuckItems', () => q.stuckItems(db), (r) => `rows=${r.length}`)
  await step('admin failedItems', () => q.failedItems(db, page), (r) => `rows=${r.rows.length} lastOk=${r.rows[0]?.last_ok_stage}`)
  await step('admin itemTimeline', () => q.itemTimeline(db, failedItem), (r) => `events=${r?.events.length}`)
  await step('admin ingestRuns', () => q.ingestRuns(db, page), (r) => brief(r.rows[0]))
  const rid = await step('admin latestRunId', () => q.latestRunId(db), brief)
  if (rid) await step('admin ingestTasks', () => q.ingestTasks(db, rid), (r) => `rows=${r.length}`)
  await step('admin renderRows (all)', () => q.renderRows(db, page, null), (r) => `rows=${r.rows.length}`)
  await step('admin renderRows (failed)', () => q.renderRows(db, page, 'failed' as any), (r) => `rows=${r.rows.length}`)
  await step('admin sourceHealth', () => q.sourceHealth(db), (r) => `sources=${r.sources.length} wm=${r.watermarks.length} ${brief(r.sources[0])}`)
  await step('admin youtubeDiscovery', () => q.youtubeDiscovery(db), brief)
  await step('admin transcriptHealth', () => q.transcriptHealth(db), brief)
  await step('admin renderFailureLastHour', () => q.renderFailureLastHour(db), brief)
  await step('admin ttsFailureRecent', () => q.ttsFailureRecent(db), brief)
  await step('admin spendLedger', () => q.spendLedger(db), (r) => brief(r).slice(0, 160))
  await step('admin askLog', () => q.askLog(db, page, null), (r) => `rows=${r.rows.length}`)
  await step('admin askLog filtered', () => q.askLog(db, page, 'answered' as any), (r) => `rows=${r.rows.length}`)
  await step('admin currentSettings', () => q.currentSettings(db, log), (m) => `n=${m.size}`)

  const c = await import('../../apps/web/src/server/admin/commands')
  await step('admin retryItem (failed -> found)', async () => brief(await c.retryItem(db, { itemId: failedItem, stage: 'found' as any, adminId }, log)))
  await step('admin retryItem again (stale)', async () => brief(await c.retryItem(db, { itemId: failedItem, stage: 'found' as any, adminId }, log)))
  await step('admin retryRender', async () => brief(await c.retryRender(db, { renderId: failedRender, adminId }, log)))
  const f2 = randomUUID()
  await sql`insert into item (id, canonical_key, canonical_url, kind, title, status, published_at) values (${f2}::uuid, ${'smoke:' + f2}, 'https://example.com/d', 'article', 'to discard', 'failed', now())`.execute(db)
  await step('admin discardItem', async () => brief(await c.discardItem(db, { itemId: f2, adminId }, log)))
  await step('admin failedItems hides discarded', async () => { const r = await q.failedItems(db, page); if (r.rows.some((x) => x.id === f2)) throw new Error('discarded item still listed'); return `rows=${r.rows.length}` })
  const tid = await sql<{ id: string }>`select id from ingest_task where status='failed' limit 1`.execute(db)
  if (tid.rows[0]) await step('admin retryIngestTask', async () => brief(await c.retryIngestTask(db, { taskId: tid.rows[0]!.id }, log)))
  await step('admin saveSetting', async () => brief(await c.saveSetting(db, { name: 'dailyReelCap', raw: '7' }, log)))
} catch (e: any) {
  results.push({ name: 'HARNESS CRASH', ok: false, detail: `${e?.stack ?? e}` })
} finally {
  await client.query('rollback').catch(() => {})
  const left = await client.query(`select (select count(*) from item where canonical_key like 'smoke:%') items, (select count(*) from profile where id in ($1,$2)) profiles`, [profileId, adminId])
  results.push({ name: 'rollback verified (leftover fixtures)', ok: left.rows[0].items === '0' && left.rows[0].profiles === '0', detail: JSON.stringify(left.rows[0]) })
  await client.end()
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`)
  process.exit(0)
}
