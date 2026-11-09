import {
  AskOutcome,
  SETTINGS,
  getSetting,
  recordSpend,
  spendTodayUsd,
  toVectorLiteral,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import type { CitationDto } from '@/lib/api-types'
import { ASK_TOP_K, type EvidenceChunk } from '@/lib/ask/evidence'
import { embedQuestion, generateAnswer } from '@/lib/ask/gemini'
import { isOverHourlyLimit } from '@/lib/ask/gate'
import { askSpendInput } from '@/lib/ask/pricing'
import type { AskDeps, AskLogEntry } from '@/lib/ask/service'
import { getDb } from './db'
import { geminiConfig } from './env'

type RetrievedRow = {
  id: string
  item_id: string
  text: string
  title: string
  url: string
  published_at: Date
  similarity: number
}

function entryColumns(entry: AskLogEntry) {
  return {
    answer: entry.answer,
    citations: entry.citations ? JSON.stringify(entry.citations) : null,
    outcome: entry.outcome,
    latency_ms: entry.latencyMs,
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    conversation_id: entry.conversationId,
    cached: entry.cached,
  }
}

export function createAskDeps(log: Logger): AskDeps {
  const db = getDb()
  return {
    log,
    limits: async () => ({
      hourlyLimit: await getSetting(db, SETTINGS.askHourlyLimitPerUser, log),
      dailyCapUsd: await getSetting(db, SETTINGS.askDailySpendCapUsd, log),
    }),
    spentTodayUsd: () => spendTodayUsd(db, ['ask']),
    reserveAsk: (input) =>
      db.transaction().execute(async (trx) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${`ask:${input.profileId}`}, 0))`.execute(
          trx,
        )
        const row = await trx
          .selectFrom('ask_query')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('profile_id', '=', input.profileId)
          .where('outcome', '!=', AskOutcome.rate_limited)
          .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
          .executeTakeFirst()
        const recentAsks = Number(row?.n ?? 0)
        if (isOverHourlyLimit(recentAsks, input.hourlyLimit)) {
          log.info({ profileId: input.profileId, recentAsks }, 'ask hourly limit reached')
          return null
        }
        // 'error' is a placeholder so a crash before completeQuery still counts against the limit.
        const inserted = await trx
          .insertInto('ask_query')
          .values({
            profile_id: input.profileId,
            question: input.question,
            normalized_question: input.normalized,
            conversation_id: input.conversationId,
            outcome: AskOutcome.error,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
        return inserted.id
      }),
    findCached: async (normalized) => {
      const row = await db
        .selectFrom('ask_query')
        .select(['answer', 'citations'])
        .where('normalized_question', '=', normalized)
        .where('outcome', '=', 'answered')
        .where('cached', '=', false)
        .where('answer', 'is not', null)
        .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst()
      if (!row?.answer || !Array.isArray(row.citations)) return null
      return { answer: row.answer, citations: row.citations as CitationDto[] }
    },
    embed: (text) => embedQuestion(geminiConfig(), text, log),
    retrieve: async (embedding) => {
      const vector = toVectorLiteral(embedding)
      const result = await sql<RetrievedRow>`
        select ec.id, ec.item_id, ec.text, i.title, m.url, m.published_at,
               1 - (ec.embedding <=> ${vector}::vector) as similarity
        from evidence_chunk ec
        join item i on i.id = ec.item_id
        join mention m on m.id = ec.mention_id
        where ec.embedding is not null
        order by ec.embedding <=> ${vector}::vector
        limit ${ASK_TOP_K}`.execute(db)
      return result.rows.map((row): EvidenceChunk => ({
        id: row.id,
        itemId: row.item_id,
        text: row.text,
        title: row.title,
        url: row.url,
        publishedAt: new Date(row.published_at).toISOString(),
        similarity: Number(row.similarity),
      }))
    },
    generate: (question, chunks, onText) =>
      generateAnswer(geminiConfig(), question, chunks, log, onText),
    recordSpend: (category, units, costUsd) =>
      recordSpend(db, askSpendInput(category, units, costUsd), log),
    logQuery: async (entry) => {
      await db
        .insertInto('ask_query')
        .values({
          profile_id: entry.profileId,
          question: entry.question,
          normalized_question: entry.normalized,
          ...entryColumns(entry),
        })
        .execute()
    },
    completeQuery: async (reservationId, entry) => {
      await db
        .updateTable('ask_query')
        .set(entryColumns(entry))
        .where('id', '=', reservationId)
        .execute()
    },
  }
}
