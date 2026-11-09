import { AskOutcome, errorFields, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import type { CitationDto, RelatedReelDto } from '@/lib/api-types'
import {
  HISTORY_PAGE_SIZE,
  decodeHistoryCursor,
  encodeHistoryCursor,
  type HistoryEntry,
  type HistoryPage,
} from '@/lib/ask/history'
import { resolveRelatedReels } from './related-reels'

type ListRow = {
  key: string
  id: string
  question: string
  preview: string
  turns: string | number
  last_at: Date | string
}

export function historyListQuery(params: {
  profileId: string
  cursor: { at: string; key: string } | null
  limit: number
}) {
  const { profileId, cursor, limit } = params
  const after = cursor
    ? sql`having (max(created_at), coalesce(conversation_id, id)) < (${cursor.at}::timestamptz, ${cursor.key}::uuid)`
    : sql``
  return sql<ListRow>`
    select coalesce(conversation_id, id) as key,
      (array_agg(id order by created_at asc))[1] as id,
      (array_agg(question order by created_at asc))[1] as question,
      (array_agg(left(answer, 220) order by created_at desc))[1] as preview,
      count(*) as turns,
      max(created_at) as last_at
    from ask_query
    where profile_id = ${profileId}::uuid
      and deleted_at is null
      and outcome = ${AskOutcome.answered}
      and answer is not null
    group by coalesce(conversation_id, id)
    ${after}
    order by max(created_at) desc, coalesce(conversation_id, id) desc
    limit ${limit + 1}`
}

export async function listHistory(
  db: Database,
  profileId: string,
  rawCursor: string | null,
  log?: Logger,
  limit = HISTORY_PAGE_SIZE,
): Promise<HistoryPage> {
  const cursor = decodeHistoryCursor(rawCursor)
  if (rawCursor && !cursor) log?.warn('invalid history cursor ignored')
  const { rows } = await historyListQuery({ profileId, cursor, limit }).execute(db)
  const page = rows.slice(0, limit)
  const entries: HistoryEntry[] = page.map((r) => ({
    id: r.id,
    question: r.question,
    preview: r.preview,
    turns: Number(r.turns),
    lastAt: new Date(r.last_at).toISOString(),
  }))
  const lastRow = page[page.length - 1]
  const nextCursor =
    rows.length > limit && lastRow
      ? encodeHistoryCursor({ at: new Date(lastRow.last_at).toISOString(), key: lastRow.key })
      : null
  return { entries, nextCursor }
}

export function ownedQueryQuery(db: Database, profileId: string, askId: string) {
  return db
    .selectFrom('ask_query')
    .select(['id', 'conversation_id'])
    .where('id', '=', askId)
    .where('profile_id', '=', profileId)
    .where('deleted_at', 'is', null)
}

export function turnsQuery(
  db: Database,
  profileId: string,
  owned: { id: string; conversation_id: string | null },
) {
  return db
    .selectFrom('ask_query')
    .select(['id', 'question', 'answer', 'citations', 'created_at'])
    .where('profile_id', '=', profileId)
    .where('deleted_at', 'is', null)
    .where('outcome', '=', AskOutcome.answered)
    .where('answer', 'is not', null)
    .where((eb) =>
      owned.conversation_id
        ? eb.or([eb('conversation_id', '=', owned.conversation_id), eb('id', '=', owned.id)])
        : eb('id', '=', owned.id),
    )
    .orderBy('created_at', 'asc')
}

export type ConversationTurn = {
  id: string
  question: string
  answer: string
  citations: CitationDto[]
  reels: RelatedReelDto[]
  createdAt: string
}

export type Conversation = { id: string; turns: ConversationTurn[] }

export async function getConversation(
  db: Database,
  profileId: string,
  askId: string,
  mediaBase: string,
  log?: Logger,
): Promise<Conversation | null> {
  const owned = await ownedQueryQuery(db, profileId, askId).executeTakeFirst()
  if (!owned) {
    log?.info({ profileId, askId }, 'history entry not found for viewer')
    return null
  }
  const rows = await turnsQuery(db, profileId, owned).execute()
  if (rows.length === 0) return null
  const turns = await Promise.all(
    rows.map(async (row): Promise<ConversationTurn> => {
      const citations = Array.isArray(row.citations) ? (row.citations as CitationDto[]) : []
      return {
        id: row.id,
        question: row.question,
        answer: row.answer ?? '',
        citations,
        reels: await resolveRelatedReels(db, citations, mediaBase, log),
        createdAt: new Date(row.created_at).toISOString(),
      }
    }),
  )
  return { id: askId, turns }
}

export function deleteConversationQuery(db: Database, profileId: string, askId: string) {
  return db
    .updateTable('ask_query')
    .set({ deleted_at: new Date() })
    .where('profile_id', '=', profileId)
    .where('deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('id', '=', askId),
        eb(
          'conversation_id',
          '=',
          eb
            .selectFrom('ask_query as q')
            .select('q.conversation_id')
            .where('q.id', '=', askId)
            .where('q.profile_id', '=', profileId),
        ),
      ]),
    )
}

export async function deleteConversation(
  db: Database,
  profileId: string,
  askId: string,
  log?: Logger,
): Promise<number> {
  try {
    const res = await deleteConversationQuery(db, profileId, askId).executeTakeFirst()
    const count = Number(res.numUpdatedRows)
    log?.info({ profileId, askId, count }, 'ask history deleted')
    return count
  } catch (err) {
    log?.error(errorFields(err), 'ask history delete failed')
    throw err
  }
}
