import {
  EventName,
  ItemStatus,
  RenderStatus,
  SETTINGS,
  fromVectorLiteral,
  getSetting,
  toVectorLiteral,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql, type RawBuilder } from 'kysely'
import { jsonArrayFrom } from 'kysely/helpers/postgres'
import {
  COMPLETE_MIN_WATCH_RATIO,
  COMPLETE_WEIGHT,
  LIKE_WEIGHT,
  type WeightedVector,
} from './taste'
import type { Candidate } from './scoring'

export const CANDIDATE_POOL_SIZE = 400
export const MAX_TASTE_SIGNALS = 200

export function loadFeedMinTemplate(db: Database, log?: Logger): Promise<number> {
  const quiet = { warn: () => {} } as unknown as Logger
  return getSetting(db, SETTINGS.feedMinTemplate, log ?? quiet)
}

type CandidateRow = {
  id: string
  score: number
  published_at: Date | string
  topics: string[]
  similarity: number | string | null
}

export function candidatesQuery(params: {
  profileId: string | null
  asOf: string
  poolSize: number
  minTemplate: number
  sources?: readonly string[]
}): RawBuilder<CandidateRow> {
  const { profileId, asOf, poolSize, minTemplate } = params
  const sources = params.sources ?? []
  const sourceFilter = sources.length
    ? sql`and exists (
        select 1 from mention m
        where m.item_id = i.id and m.source::text = any(${sql.val([...sources])}::text[])
      )`
    : sql``
  return sql<CandidateRow>`
    select i.id, i.score, i.published_at, i.topics,
      case when p.taste_embedding is not null and i.embedding is not null
        then 1 - (i.embedding <=> p.taste_embedding) end as similarity
    from item i
    left join profile p on p.id = ${profileId}::uuid
    where i.status = ${ItemStatus.rendered}::item_status
      and coalesce(i.rendered_at, i.created_at) <= ${asOf}::timestamptz
      and exists (
        select 1 from render r
        where r.item_id = i.id
          and r.status = ${RenderStatus.done}::render_status
          and r.video_key is not null
          and coalesce(r.template_version, 0) >= ${minTemplate}
      )
      ${sourceFilter}
    order by i.published_at desc, i.id desc
    limit ${poolSize}`
}

export async function loadCandidates(
  db: Database,
  params: {
    profileId: string | null
    asOf: string
    minTemplate: number
    poolSize?: number
    sources?: readonly string[]
  },
): Promise<Candidate[]> {
  const result = await candidatesQuery({ poolSize: CANDIDATE_POOL_SIZE, ...params }).execute(db)
  return result.rows.map((row) => ({
    id: row.id,
    score: Number(row.score),
    publishedAt: new Date(row.published_at),
    topics: row.topics,
    similarity: row.similarity === null ? null : Number(row.similarity),
  }))
}

export async function loadProfileSignals(
  db: Database,
  profileId: string,
): Promise<{ signalCount: number; topics: string[]; sources: string[] }> {
  const row = await db
    .selectFrom('profile')
    .select(['signal_count', 'topics', 'sources'])
    .where('id', '=', profileId)
    .executeTakeFirst()
  return {
    signalCount: row?.signal_count ?? 0,
    topics: row?.topics ?? [],
    sources: row?.sources ?? [],
  }
}

export function hydrateQuery(
  db: Database,
  params: { profileId: string | null; itemIds: string[]; minTemplate: number },
) {
  const { profileId, itemIds, minTemplate } = params
  return db
    .selectFrom('item')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('render')
          .select([
            'render.video_key',
            'render.poster_key',
            'render.video_duration_ms',
            'render.credits',
          ])
          .whereRef('render.item_id', '=', 'item.id')
          .where('render.status', '=', RenderStatus.done)
          .where('render.video_key', 'is not', null)
          .where(sql<boolean>`coalesce(render.template_version, 0) >= ${minTemplate}`)
          .orderBy(sql`coalesce(render.template_version, 0) desc`)
          .orderBy(sql`render.finished_at desc nulls last`)
          .orderBy('render.created_at', 'desc')
          .limit(1)
          .as('r'),
      (join) => join.onTrue(),
    )
    .where('item.status', '=', ItemStatus.rendered)
    .where('item.id', 'in', itemIds)
    .select((eb) => [
      'item.id',
      'item.title',
      'item.tldr',
      'item.script',
      'item.topics',
      'item.kind',
      'item.canonical_url',
      'item.score',
      'item.published_at',
      'r.video_key',
      'r.poster_key',
      'r.video_duration_ms',
      'r.credits',
      jsonArrayFrom(
        eb
          .selectFrom('mention')
          .select(['mention.source', 'mention.score', 'mention.url'])
          .whereRef('mention.item_id', '=', 'item.id')
          .orderBy(sql`mention.score desc nulls last`)
          .limit(8),
      ).as('mentions'),
      eb
        .selectFrom('like')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('like.item_id', '=', 'item.id')
        .as('like_count'),
      profileId
        ? eb
            .exists(
              eb
                .selectFrom('like')
                .select(sql.lit(1).as('one'))
                .whereRef('like.item_id', '=', 'item.id')
                .where('like.profile_id', '=', profileId),
            )
            .as('liked')
        : sql<boolean>`false`.as('liked'),
      profileId
        ? eb
            .exists(
              eb
                .selectFrom('save')
                .select(sql.lit(1).as('one'))
                .whereRef('save.item_id', '=', 'item.id')
                .where('save.profile_id', '=', profileId),
            )
            .as('saved')
        : sql<boolean>`false`.as('saved'),
    ])
}

export type FeedRow = Awaited<ReturnType<ReturnType<typeof hydrateQuery>['execute']>>[number]

type SignalRow = { item_id: string; embedding: string; weight: number | string }

export function tasteSignalsQuery(profileId: string): RawBuilder<SignalRow> {
  return sql<SignalRow>`
    (select l.item_id, i.embedding::text as embedding, ${LIKE_WEIGHT}::float as weight
      from "like" l
      join item i on i.id = l.item_id
      where l.profile_id = ${profileId}::uuid and i.embedding is not null
      order by l.created_at desc
      limit ${MAX_TASTE_SIGNALS})
    union all
    (select c.item_id, c.embedding, ${COMPLETE_WEIGHT}::float as weight
      from (
        select distinct on (e.item_id) e.item_id, i.embedding::text as embedding, e.created_at
        from event e
        join item i on i.id = e.item_id
        where e.profile_id = ${profileId}::uuid
          and e.name = ${EventName.reel_complete}::event_name
          and i.embedding is not null
          and jsonb_typeof(e.meta->'watchRatio') = 'number'
          and (e.meta->>'watchRatio')::float >= ${COMPLETE_MIN_WATCH_RATIO}
        order by e.item_id, e.created_at desc
      ) c
      order by c.created_at desc
      limit ${MAX_TASTE_SIGNALS})`
}

export async function loadTasteSignals(db: Database, profileId: string): Promise<WeightedVector[]> {
  const result = await tasteSignalsQuery(profileId).execute(db)
  return result.rows.map((row) => ({
    vector: fromVectorLiteral(row.embedding),
    weight: Number(row.weight),
  }))
}

export async function storeTaste(
  db: Database,
  profileId: string,
  taste: readonly number[] | null,
  signalCount: number,
): Promise<void> {
  const literal = taste ? toVectorLiteral(taste) : null
  await sql`
    update profile
    set taste_embedding = ${literal}::vector, signal_count = ${signalCount}, updated_at = now()
    where id = ${profileId}::uuid`.execute(db)
}
