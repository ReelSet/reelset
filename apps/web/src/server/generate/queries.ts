import { REEL_REQUEST_OPEN, type Database, type ReelRequestRow } from '@reelset/core'
import { sql } from 'kysely'
import { pickRender, type RequestContext, type RequestEventInfo, type RequestItemInfo } from './dto'

async function aheadCount(db: Database, row: ReelRequestRow): Promise<number> {
  const res = await db
    .selectFrom('reel_request as r')
    .leftJoin('item as i', 'i.id', 'r.item_id')
    .select(sql<string>`count(*)`.as('n'))
    .where('r.status', 'in', [...REEL_REQUEST_OPEN])
    .where('r.created_at', '<', row.created_at)
    .where((eb) => eb.or([eb('r.item_id', 'is', null), eb('i.status', '!=', 'rendered')]))
    .executeTakeFirstOrThrow()
  return Number(res.n)
}

/** Loads items, served renders, events and queue position for a page of requests. */
export async function loadRequestContexts(
  db: Database,
  rows: readonly ReelRequestRow[],
): Promise<Map<string, RequestContext>> {
  const itemIds = [...new Set(rows.map((r) => r.item_id).filter((id): id is string => !!id))]
  const items = new Map<string, RequestItemInfo>()
  const renders = new Map<string, ReturnType<typeof pickRender>[]>()
  const events = new Map<string, RequestEventInfo[]>()

  if (itemIds.length > 0) {
    const [itemRows, renderRows, eventRows] = await Promise.all([
      db
        .selectFrom('item')
        .select(['id', 'title', 'status', 'visibility'])
        .where('id', 'in', itemIds)
        .execute(),
      db
        .selectFrom('render')
        .select([
          'item_id',
          'status',
          'video_key',
          'poster_key',
          'video_duration_ms',
          'finished_at',
          'template_version',
          'created_at',
        ])
        .where('item_id', 'in', itemIds)
        .execute(),
      db
        .selectFrom('item_event')
        .select(['item_id', 'stage', 'outcome', 'created_at'])
        .where('item_id', 'in', itemIds)
        .where('stage', 'in', ['found', 'summarized', 'rendered'])
        .execute(),
    ])
    for (const i of itemRows) items.set(i.id, i)
    for (const r of renderRows) renders.set(r.item_id, [...(renders.get(r.item_id) ?? []), r])
    for (const e of eventRows) {
      events.set(e.item_id, [
        ...(events.get(e.item_id) ?? []),
        { stage: e.stage, outcome: e.outcome, createdAt: e.created_at },
      ])
    }
  }

  const out = new Map<string, RequestContext>()
  for (const row of rows) {
    const itemId = row.item_id
    const open = (REEL_REQUEST_OPEN as readonly string[]).includes(row.status)
    out.set(row.id, {
      item: itemId ? (items.get(itemId) ?? null) : null,
      render: itemId ? pickRender((renders.get(itemId) ?? []) as never[]) : null,
      events: itemId ? (events.get(itemId) ?? []) : [],
      aheadOfYou: open ? await aheadCount(db, row) : null,
    })
  }
  return out
}
