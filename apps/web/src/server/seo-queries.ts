import {
  ItemStatus,
  SERVED_RENDER_ORDER_SQL,
  SETTINGS,
  getSetting,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import { mediaUrl } from '@/lib/media'
import { shortIdRange, slugify, topicSlug, type ReelParam } from '@/lib/reel-url'
import { scriptParts } from '@/lib/seo/script'
import { hostOf } from '@/lib/seo/site'
import type { ReelFact, ReelPageData, ReelSummary } from '@/lib/seo/types'

const MENTION_LIMIT = 8
const PARAM_CANDIDATES = 5

// The render the feed serves, or none once retention cleared its keys (left join keeps the item).
const servedRender = sql`left join lateral (
  select r.video_key, r.poster_key, r.video_duration_ms from render r
  where r.item_id = i.id and r.status = 'done' and r.video_key is not null
  order by ${sql.raw(SERVED_RENDER_ORDER_SQL)} limit 1
) served on true`

type ReelRow = {
  id: string
  title: string
  tldr: string | null
  topics: string[]
  kind: string
  canonical_url: string
  published_at: Date
  rendered_at: Date | null
  script: unknown
  video_key: string | null
  poster_key: string | null
  video_duration_ms: number | null
}

type SummaryRow = Omit<ReelRow, 'kind' | 'canonical_url' | 'rendered_at' | 'script'> & {
  updated_at: Date
  source?: string | null
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

async function loadFacts(
  db: Database,
  claims: { text: string; chunkIds: string[] }[],
): Promise<ReelFact[]> {
  const ids = [...new Set(claims.flatMap((c) => c.chunkIds))]
  if (ids.length === 0) return claims.map((c) => ({ text: c.text, sources: [] }))
  const { rows } = await sql<{ id: string; url: string; title: string | null }>`
    select c.id, m.url, m.title from evidence_chunk c join mention m on m.id = c.mention_id
    where c.id = any(${ids}::uuid[])
  `.execute(db)
  const byChunk = new Map(rows.map((r) => [r.id, r]))
  return claims.map((c) => {
    const seen = new Set<string>()
    const sources = c.chunkIds.flatMap((id) => {
      const row = byChunk.get(id)
      if (!row || seen.has(row.url)) return []
      seen.add(row.url)
      return [{ url: row.url, title: row.title?.trim() || hostOf(row.url) }]
    })
    return { text: c.text, sources }
  })
}

/** The rendered item behind `/r/<param>`, or null; a short-id collision prefers the matching slug. */
export async function loadReelPage(
  db: Database,
  param: ReelParam,
  mediaBase: string,
  log: Logger,
): Promise<ReelPageData | null> {
  const l = log.child({ fn: 'loadReelPage', shortId: param.shortId })
  const [lo, hi] = shortIdRange(param.shortId)
  const match = param.id
    ? sql`i.id = ${param.id}::uuid`
    : sql`i.id between ${lo}::uuid and ${hi}::uuid`
  const { rows } = await sql<ReelRow>`
    select i.id, i.title, i.tldr, i.topics, i.kind::text as kind, i.canonical_url, i.published_at,
      i.rendered_at, i.script, served.video_key, served.poster_key, served.video_duration_ms
    from item i ${servedRender}
    where i.status = ${ItemStatus.rendered}::item_status and ${match}
    order by i.published_at desc
    limit ${PARAM_CANDIDATES}
  `.execute(db)
  const row = rows.find((r) => slugify(r.title) === param.slug) ?? rows[0]
  if (!row) {
    l.info('reel page not found')
    return null
  }
  if (rows.length > 1) l.warn({ candidates: rows.length }, 'short id matched several reels')

  const parts = scriptParts(row.script)
  const [facts, mentions] = await Promise.all([
    loadFacts(db, parts.claims),
    db
      .selectFrom('mention')
      .select(['source', 'url', 'title', 'author', 'score', 'num_comments'])
      .where('item_id', '=', row.id)
      .orderBy(sql`score desc nulls last`)
      .limit(MENTION_LIMIT)
      .execute(),
  ])
  l.info({ itemId: row.id, hasVideo: row.video_key !== null }, 'reel page loaded')
  return {
    id: row.id,
    title: row.title,
    tldr: row.tldr,
    hook: parts.hook,
    transcript: parts.transcript,
    topics: row.topics,
    kind: row.kind,
    canonicalUrl: row.canonical_url,
    publishedAt: iso(row.published_at) ?? new Date().toISOString(),
    renderedAt: iso(row.rendered_at),
    videoUrl: mediaUrl(mediaBase, row.video_key),
    posterUrl: mediaUrl(mediaBase, row.poster_key),
    durationMs: row.video_duration_ms,
    facts,
    mentions: mentions.map((m) => ({
      source: m.source,
      url: m.url,
      title: m.title,
      author: m.author,
      score: m.score,
      comments: m.num_comments,
    })),
  }
}

function toSummary(row: SummaryRow, mediaBase: string): ReelSummary {
  return {
    id: row.id,
    title: row.title,
    tldr: row.tldr,
    topics: row.topics,
    publishedAt: iso(row.published_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    videoUrl: mediaUrl(mediaBase, row.video_key),
    posterUrl: mediaUrl(mediaBase, row.poster_key),
    durationMs: row.video_duration_ms,
    source: row.source ?? null,
  }
}

/** Rendered reels, newest first; `labels` narrows to items tagged with any of those topics. */
// Highest-scored mention names the reel's source on cards.
const leadSource = sql`(select m.source::text from mention m where m.item_id = i.id
  order by m.score desc nulls last limit 1) as source`

function sourceClause(source: string | null | undefined) {
  return source
    ? sql`and exists (select 1 from mention m where m.item_id = i.id and m.source::text = ${source})`
    : sql``
}

export async function listReelSummaries(
  db: Database,
  mediaBase: string,
  opts: { limit: number; labels?: string[]; source?: string | null },
): Promise<ReelSummary[]> {
  const topicFilter = opts.labels ? sql`and i.topics && ${opts.labels}::text[]` : sql``
  const { rows } = await sql<SummaryRow>`
    select i.id, i.title, i.tldr, i.topics, i.published_at, ${leadSource},
      coalesce(i.rendered_at, i.published_at) as updated_at,
      served.video_key, served.poster_key, served.video_duration_ms
    from item i ${servedRender}
    where i.status = ${ItemStatus.rendered}::item_status ${topicFilter} ${sourceClause(opts.source)}
    order by coalesce(i.rendered_at, i.published_at) desc, i.id desc
    limit ${opts.limit}
  `.execute(db)
  return rows.map((r) => toSummary(r, mediaBase))
}

export async function countRenderedReels(db: Database): Promise<number> {
  const { rows } = await sql<{ count: number }>`
    select count(*)::int as count from item i where i.status = ${ItemStatus.rendered}::item_status
  `.execute(db)
  return rows[0]?.count ?? 0
}

/** Rendered reels per source (a reel counts once per source it was found on). */
export async function listSourceCounts(
  db: Database,
  labels?: string[],
): Promise<{ source: string; count: number }[]> {
  const topicFilter = labels ? sql`and i.topics && ${labels}::text[]` : sql``
  const { rows } = await sql<{ source: string; count: number }>`
    select m.source::text as source, count(distinct i.id)::int as count
    from item i join mention m on m.item_id = i.id
    where i.status = ${ItemStatus.rendered}::item_status ${topicFilter}
    group by m.source
  `.execute(db)
  return rows
}

/** Recent reels with transcript and source, for /llms-full.txt. */
export async function listReelTranscripts(db: Database, mediaBase: string, limit: number) {
  const { rows } = await sql<SummaryRow & { script: unknown; canonical_url: string }>`
    select i.id, i.title, i.tldr, i.topics, i.published_at, i.canonical_url, i.script,
      coalesce(i.rendered_at, i.published_at) as updated_at,
      served.video_key, served.poster_key, served.video_duration_ms
    from item i ${servedRender}
    where i.status = ${ItemStatus.rendered}::item_status
    order by coalesce(i.rendered_at, i.published_at) desc, i.id desc
    limit ${limit}
  `.execute(db)
  return rows.map((r) => ({
    ...toSummary(r, mediaBase),
    transcript: scriptParts(r.script).transcript,
    sourceUrl: r.canonical_url,
  }))
}

/** Raw topic labels of rendered reels with their reel counts. */
export async function listTopicLabels(
  db: Database,
  source?: string | null,
): Promise<{ label: string; count: number }[]> {
  const { rows } = await sql<{ label: string; count: number }>`
    select t as label, count(*)::int as count
    from item i, unnest(i.topics) t
    where i.status = ${ItemStatus.rendered}::item_status ${sourceClause(source)}
    group by t
  `.execute(db)
  return rows
}

export function labelsForSlug(rows: { label: string }[], slug: string): string[] {
  return rows.filter((r) => topicSlug(r.label) === slug).map((r) => r.label)
}

export async function loadRetentionDays(db: Database, log: Logger): Promise<number> {
  return getSetting(db, SETTINGS.reelRetentionDays, log)
}
