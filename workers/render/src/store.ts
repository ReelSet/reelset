import { sql } from 'kysely'
import {
  SETTINGS,
  getSetting,
  parseItemImages,
  type Database,
  type ItemImage,
  type ItemStatus,
  type Logger,
  type RenderStatus,
  type Source,
} from '@reelset/core'
import {
  MAX_RETRIES,
  ORPHAN_CURSOR_SETTING_KEY,
  UPGRADE_MAX_ATTEMPTS,
  UPGRADE_SENT_SETTING_KEY,
} from './constants'
import { RETRYABLE_FAILURE_CODES } from './errors'
import { buildFacts, type ItemFacts } from './facts'
import { parseDemo, type ItemDemo } from './demo'
import { sourceLabel } from './plan'

export type ItemForRender = {
  id: string
  title: string
  status: ItemStatus
  script: unknown
  contentHash: string | null
  promptVersion: string | null
  sourceLabel: string
  source: Source | null
  canonicalUrl: string
  mentionUrl: string | null
  images: ItemImage[]
  demo?: ItemDemo
  facts: ItemFacts
}

export type RenderRow = {
  id: string
  status: RenderStatus
  videoKey: string | null
  posterKey: string | null
}

export type RenderDone = {
  videoKey: string
  posterKey: string
  bytes: number
  videoDurationMs: number
  renderMs: number
  credits?: unknown[]
}

export interface RenderStore {
  loadItem(itemId: string): Promise<ItemForRender | null>
  ensureRender(itemId: string, renderKey: string, templateVersion?: number): Promise<RenderRow>
  markRendering(renderKey: string): Promise<void>
  markDone(renderKey: string, done: RenderDone): Promise<void>
  markFailed(renderKey: string, error: string): Promise<void>
}

export type StuckRender = { renderId: string; itemId: string }
export type ExpiredRender = { id: string; videoKey: string | null; posterKey: string | null }

export type UpgradeSent = { id: string; at: number }
export type UpgradeCandidate = {
  id: string
  contentHash: string
  promptVersion: string
  score: number
  publishedAt: Date
  bestTemplate: number
}

export interface MaintenanceStore {
  failStuckRenders(cutoff: Date): Promise<StuckRender[]>
  doneKeys(keys: readonly string[]): Promise<Set<string>>
  expiredRenders(cutoff: Date, limit: number): Promise<ExpiredRender[]>
  clearRenderKeys(ids: readonly string[]): Promise<void>
  renderCountsSince(since: Date): Promise<{ total: number; failed: number }>
  deadLetteredSince(since: Date): Promise<number>
  renderedForUpgrade(limit: number): Promise<UpgradeCandidate[]>
  existingRenderKeys(keys: readonly string[]): Promise<Set<string>>
  feedMinTemplate(): Promise<number>
  activeRenderCount(): Promise<number>
  pendingNewItemCount(): Promise<number>
  getUpgradeSent(): Promise<UpgradeSent[]>
  setUpgradeSent(sent: UpgradeSent[]): Promise<void>
  getOrphanCursor(): Promise<string | null>
  setOrphanCursor(cursor: string | null): Promise<void>
}

export function createRenderStore(db: Database, log: Logger): RenderStore {
  return {
    async loadItem(itemId) {
      const item = await db
        .selectFrom('item')
        .select([
          'id',
          'title',
          'status',
          'script',
          'content_hash',
          'prompt_version',
          'canonical_url',
          'images',
          'demo',
        ])
        .where('id', '=', itemId)
        .executeTakeFirst()
      if (!item) return null
      const mentions = await db
        .selectFrom('mention')
        .select(['source', 'url', 'title', 'author', 'score', 'num_comments', 'raw'])
        .where('item_id', '=', itemId)
        .orderBy(sql`score desc nulls last`)
        .limit(12)
        .execute()
      const mention = mentions[0]
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        script: item.script,
        contentHash: item.content_hash,
        promptVersion: item.prompt_version,
        sourceLabel: sourceLabel((mention?.source ?? null) as Source | null),
        source: (mention?.source ?? null) as Source | null,
        canonicalUrl: item.canonical_url,
        mentionUrl: mention?.url ?? null,
        images: parseItemImages(item.images),
        demo: parseDemo(item.demo, item.canonical_url),
        facts: buildFacts(
          mentions.map((m) => ({
            source: m.source as Source,
            url: m.url,
            title: m.title,
            author: m.author,
            score: m.score,
            numComments: m.num_comments,
            raw: m.raw,
          })),
          item.canonical_url,
        ),
      }
    },

    async ensureRender(itemId, renderKey, templateVersion) {
      await db
        .insertInto('render')
        .values({
          item_id: itemId,
          render_key: renderKey,
          template_version: templateVersion ?? null,
        })
        .onConflict((oc) => oc.column('render_key').doNothing())
        .execute()
      const row = await db
        .selectFrom('render')
        .select(['id', 'status', 'video_key', 'poster_key'])
        .where('render_key', '=', renderKey)
        .executeTakeFirstOrThrow()
      log.debug({ itemId, renderKey, renderStatus: row.status }, 'render row ensured')
      return { id: row.id, status: row.status, videoKey: row.video_key, posterKey: row.poster_key }
    },

    async markRendering(renderKey) {
      await db
        .updateTable('render')
        .set({
          status: 'rendering',
          started_at: sql`now()`,
          finished_at: null,
          error: null,
          attempts: sql`attempts + 1`,
        })
        .where('render_key', '=', renderKey)
        .where('status', '!=', 'done')
        .execute()
    },

    async markDone(renderKey, done) {
      await db
        .updateTable('render')
        .set({
          status: 'done',
          video_key: done.videoKey,
          poster_key: done.posterKey,
          bytes: done.bytes,
          video_duration_ms: done.videoDurationMs,
          render_ms: done.renderMs,
          credits: done.credits?.length ? JSON.stringify(done.credits) : null,
          error: null,
          finished_at: sql`now()`,
        })
        .where('render_key', '=', renderKey)
        .execute()
    },

    async markFailed(renderKey, error) {
      await db
        .updateTable('render')
        .set({ status: 'failed', error, finished_at: sql`now()` })
        .where('render_key', '=', renderKey)
        .where('status', '!=', 'done')
        .execute()
    },
  }
}

export function createMaintenanceStore(db: Database, log: Logger): MaintenanceStore {
  return {
    async failStuckRenders(cutoff) {
      return db.transaction().execute(async (trx) => {
        const failed = await trx
          .updateTable('render')
          .set({ status: 'failed', error: 'stuck_timeout', finished_at: sql`now()` })
          .where('status', '=', 'rendering')
          .where('started_at', '<', cutoff)
          .returning(['id', 'item_id'])
          .execute()
        const itemIds = [...new Set(failed.map((r) => r.item_id))]
        if (itemIds.length > 0) {
          await trx
            .updateTable('item')
            .set({ queued_at: null, updated_at: sql`now()` })
            .where('id', 'in', itemIds)
            .where('status', 'in', ['embedded', 'voiced'])
            .execute()
        }
        return failed.map((r) => ({ renderId: r.id, itemId: r.item_id }))
      })
    },

    async doneKeys(keys) {
      if (keys.length === 0) return new Set()
      const rows = await db
        .selectFrom('render')
        .select(['video_key', 'poster_key'])
        .where('status', '=', 'done')
        .where((eb) => eb.or([eb('video_key', 'in', keys), eb('poster_key', 'in', keys)]))
        .execute()
      return new Set(
        rows.flatMap((r) => [r.video_key, r.poster_key]).filter((k): k is string => !!k),
      )
    },

    async expiredRenders(cutoff, limit) {
      const rows = await db
        .selectFrom('render')
        .innerJoin('item', 'item.id', 'render.item_id')
        .select(['render.id', 'render.video_key', 'render.poster_key'])
        .where('render.status', '=', 'done')
        .where((eb) =>
          eb.or([eb('render.video_key', 'is not', null), eb('render.poster_key', 'is not', null)]),
        )
        .where('item.published_at', '<', cutoff)
        .limit(limit)
        .execute()
      return rows.map((r) => ({ id: r.id, videoKey: r.video_key, posterKey: r.poster_key }))
    },

    async clearRenderKeys(ids) {
      if (ids.length === 0) return
      await db
        .updateTable('render')
        .set({ video_key: null, poster_key: null })
        .where('id', 'in', ids)
        .execute()
    },

    async renderCountsSince(since) {
      const row = await db
        .selectFrom('render')
        .select([
          sql<string>`count(*)`.as('total'),
          sql<string>`count(*) filter (where status = 'failed')`.as('failed'),
        ])
        .where('status', 'in', ['done', 'failed'])
        .where('finished_at', '>=', since)
        .executeTakeFirstOrThrow()
      return { total: Number(row.total), failed: Number(row.failed) }
    },

    async deadLetteredSince(since) {
      const row = await db
        .selectFrom('render')
        .select(sql<string>`count(*)`.as('n'))
        .where('status', '=', 'failed')
        .where('error', '!=', 'stuck_timeout')
        .where('attempts', '>', MAX_RETRIES)
        .where('finished_at', '>=', since)
        .executeTakeFirstOrThrow()
      return Number(row.n)
    },

    async renderedForUpgrade(limit) {
      const rows = await db
        .selectFrom('item')
        .select([
          'id',
          'content_hash',
          'prompt_version',
          'score',
          'published_at',
          sql<number>`coalesce((
            select max(r.template_version) from render r
            where r.item_id = item.id and r.status = 'done' and r.video_key is not null
          ), 0)`.as('best_template'),
        ])
        .where('status', '=', 'rendered')
        .where('content_hash', 'is not', null)
        .where('prompt_version', 'is not', null)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('render')
              .select(sql<number>`1`.as('one'))
              .whereRef('render.item_id', '=', 'item.id')
              .where('render.status', '=', 'done')
              .where('render.video_key', 'is not', null),
          ),
        )
        .orderBy('published_at', 'desc')
        .limit(limit)
        .execute()
      return rows.flatMap((r) =>
        r.content_hash && r.prompt_version
          ? [
              {
                id: r.id,
                contentHash: r.content_hash,
                promptVersion: r.prompt_version,
                score: Number(r.score),
                publishedAt: new Date(r.published_at),
                bestTemplate: Number(r.best_template),
              },
            ]
          : [],
      )
    },

    async feedMinTemplate() {
      return getSetting(db, SETTINGS.feedMinTemplate, log)
    },

    async existingRenderKeys(keys) {
      if (keys.length === 0) return new Set()
      const rows = await db
        .selectFrom('render')
        .select('render_key')
        .where('render_key', 'in', keys)
        .where((eb) =>
          eb.not(
            eb.or([
              eb.and([eb('status', '=', 'failed'), eb('error', '=', 'stale_container_template')]),
              eb.and([
                eb('status', '=', 'failed'),
                eb('error', 'in', RETRYABLE_FAILURE_CODES),
                eb('attempts', '<', UPGRADE_MAX_ATTEMPTS),
              ]),
            ]),
          ),
        )
        .execute()
      return new Set(rows.map((r) => r.render_key))
    },

    async activeRenderCount() {
      const row = await db
        .selectFrom('render')
        .select(sql<string>`count(*)`.as('n'))
        .where('status', '=', 'rendering')
        .executeTakeFirstOrThrow()
      return Number(row.n)
    },

    async pendingNewItemCount() {
      const row = await db
        .selectFrom('item')
        .select(sql<string>`count(*)`.as('n'))
        .where('status', 'in', ['embedded', 'voiced'])
        .executeTakeFirstOrThrow()
      return Number(row.n)
    },

    async getUpgradeSent() {
      const row = await db
        .selectFrom('app_setting')
        .select('value')
        .where('key', '=', UPGRADE_SENT_SETTING_KEY)
        .executeTakeFirst()
      const value = row?.value
      if (!Array.isArray(value)) return []
      return value.flatMap((v) => {
        const e = v as Partial<UpgradeSent> | null
        return typeof e?.id === 'string' && typeof e.at === 'number' ? [{ id: e.id, at: e.at }] : []
      })
    },

    async setUpgradeSent(sent) {
      const value = JSON.stringify(sent)
      await db
        .insertInto('app_setting')
        .values({ key: UPGRADE_SENT_SETTING_KEY, value })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: sql`now()` }))
        .execute()
    },

    async getOrphanCursor() {
      const row = await db
        .selectFrom('app_setting')
        .select('value')
        .where('key', '=', ORPHAN_CURSOR_SETTING_KEY)
        .executeTakeFirst()
      return typeof row?.value === 'string' ? row.value : null
    },

    async setOrphanCursor(cursor) {
      const value = JSON.stringify(cursor)
      await db
        .insertInto('app_setting')
        .values({ key: ORPHAN_CURSOR_SETTING_KEY, value })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: sql`now()` }))
        .execute()
    },
  }
}
