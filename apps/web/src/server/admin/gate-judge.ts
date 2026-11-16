import { errorFields, latestGateJudgement, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import { z } from 'zod'
import { toGateView } from '@/lib/admin/gate'
import {
  JUDGE_PATH,
  JUDGE_TIMEOUT_MS,
  judgeErrorMessage,
  parseItemReference,
  parseJudgeResponse,
  type ItemReference,
  type JudgeOutcome,
} from '@/lib/admin/gate-judge'
import { VERDICT_LABELS, fmtGateScore, type GateView } from '@/lib/admin/gate-view'
import { shortIdRange } from '@/lib/reel-url'
import type { CommandResult } from './commands'
import { itemSource } from './queries'

export type JudgeFn = (itemId: string, log: Logger) => Promise<JudgeOutcome>

const CHANGES_NOTHING = 'Nothing about the item or its reel changed.'

/** Asks the ingest worker to judge one item now; the row it stores is a manual, never-applied judgement. */
export async function requestGateJudgement(itemId: string, log: Logger): Promise<JudgeOutcome> {
  const base = process.env.INGEST_INTERNAL_URL
  const token = process.env.INGEST_INTERNAL_TOKEN
  if (!base || !token) {
    log.warn({ itemId }, 'gate judge not configured')
    return { ok: false, code: 'not_configured' }
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}${JUDGE_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ itemId }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    })
    const outcome = parseJudgeResponse(res.status, await res.json().catch(() => null))
    log.info(
      { itemId, status: res.status, ok: outcome.ok, code: outcome.ok ? undefined : outcome.code },
      'gate judge answered',
    )
    return outcome
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    log.warn({ ...errorFields(err), itemId, timedOut }, 'gate judge request failed')
    return { ok: false, code: timedOut ? 'judge_timeout' : 'unreachable' }
  }
}

/** Judges one item on demand for analysis and reports the verdict; the item itself is never changed. */
export async function judgeItemNow(
  input: { itemId: unknown },
  log: Logger,
  judge: JudgeFn = requestGateJudgement,
): Promise<CommandResult> {
  const id = z.guid().safeParse(input.itemId)
  if (!id.success) return { ok: false, message: 'Invalid item id' }
  const outcome = await judge(id.data, log.child({ fn: 'judgeItemNow', itemId: id.data }))
  if (!outcome.ok) return { ok: false, message: judgeErrorMessage(outcome.code) }
  const { verdict, score, threshold } = outcome.decision
  const scored = score === null ? '' : `, ${fmtGateScore(score)} against ${fmtGateScore(threshold)}`
  return { ok: true, message: `Gate says ${VERDICT_LABELS[verdict]}${scored}. ${CHANGES_NOTHING}` }
}

export type CheckedItem = { id: string; title: string; status: string; source: string }

/** Finds the item an admin's pasted reference points at; the newest one when a source URL matches several. */
export async function findItemByReference(
  db: Database,
  ref: ItemReference,
): Promise<CheckedItem | null> {
  let query = db
    .selectFrom('item')
    .select(['item.id', 'item.title', 'item.status', itemSource.as('source')])
  if (ref.kind === 'id') query = query.where('item.id', '=', ref.id)
  if (ref.kind === 'shortId') {
    const [low, high] = shortIdRange(ref.shortId)
    query = query.where(sql<boolean>`item.id between ${low}::uuid and ${high}::uuid`)
  }
  if (ref.kind === 'url') {
    query = query.where((eb) =>
      eb.or([
        eb('item.canonical_url', 'in', ref.candidates),
        eb.exists(
          eb
            .selectFrom('mention')
            .select('mention.id')
            .whereRef('mention.item_id', '=', 'item.id')
            .where('mention.url', 'in', ref.candidates),
        ),
      ]),
    )
  }
  const row = await query.orderBy('item.first_seen_at', 'desc').limit(1).executeTakeFirst()
  return row ?? null
}

export type LinkCheck =
  | { kind: 'invalid'; message: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'failed'; item: CheckedItem; message: string }
  | { kind: 'card'; item: CheckedItem; gate: GateView; judgedNow: boolean }

async function judgementView(db: Database, itemId: string): Promise<GateView | null> {
  const row = await latestGateJudgement(db, itemId)
  return row ? toGateView(row) : null
}

/** "Check a link": resolves what was pasted to an item, judges it once if the gate never has, and returns its score card. Analysis only. */
export async function checkLink(
  db: Database,
  raw: unknown,
  log: Logger,
  judge: JudgeFn = requestGateJudgement,
): Promise<LinkCheck> {
  const l = log.child({ fn: 'checkLink' })
  const ref = typeof raw === 'string' ? parseItemReference(raw) : null
  if (!ref) {
    return { kind: 'invalid', message: 'Paste a reelset reel link, a source URL or an item id.' }
  }
  try {
    const item = await findItemByReference(db, ref)
    if (!item) {
      l.info({ refKind: ref.kind }, 'checked link matches no item')
      return { kind: 'not_found', message: 'This source is not in reelset yet.' }
    }
    const existing = await judgementView(db, item.id)
    if (existing) return { kind: 'card', item, gate: existing, judgedNow: false }
    const outcome = await judge(item.id, l.child({ itemId: item.id }))
    if (!outcome.ok) return { kind: 'failed', item, message: judgeErrorMessage(outcome.code) }
    const gate = await judgementView(db, item.id)
    if (!gate) return { kind: 'failed', item, message: judgeErrorMessage('internal_error') }
    return { kind: 'card', item, gate, judgedNow: true }
  } catch (err) {
    l.error(errorFields(err), 'link check failed')
    return { kind: 'invalid', message: 'Could not look this up. See the server logs.' }
  }
}
