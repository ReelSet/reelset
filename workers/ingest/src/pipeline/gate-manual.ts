import {
  GATE_PROMPT_VERSION,
  errorFields,
  gateConfigHash,
  loadGateConfig,
  parseItemImages,
  recordGateDecision,
  type Database,
  type GateDecisionRow,
  type Logger,
} from '@reelset/core'
import { z } from 'zod'
import { primarySource } from '../score'
import { hasDemo, youtubeIdFromKey } from './decide'
import {
  GateBudgetError,
  GateJudgeError,
  GateTimeoutError,
  draftDecision,
  type GateDeps,
  type GateItem,
} from './gate'
import { QuotaExhaustedError } from './quota'

export const MANUAL_JUDGE_PATH = '/internal/gate/judge'

export type ManualJudgeDeps = { db: Database; log: Logger; gate: GateDeps }

export type ManualJudgeErrorCode =
  | 'invalid_request'
  | 'item_not_found'
  | 'no_evidence'
  | 'over_budget'
  | 'quota_exhausted'
  | 'judge_timeout'
  | 'judge_failed'
  | 'internal_error'

const ERROR_STATUS: Record<ManualJudgeErrorCode, number> = {
  invalid_request: 400,
  item_not_found: 404,
  no_evidence: 422,
  over_budget: 422,
  quota_exhausted: 503,
  judge_timeout: 504,
  judge_failed: 502,
  internal_error: 500,
}

export class ManualJudgeError extends Error {
  constructor(
    readonly code: ManualJudgeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ManualJudgeError'
  }
}

export async function loadGateItem(db: Database, itemId: string): Promise<GateItem> {
  const item = await db
    .selectFrom('item')
    .select(['id', 'title', 'kind', 'canonical_key', 'score', 'images', 'demo'])
    .where('id', '=', itemId)
    .executeTakeFirst()
  if (!item) throw new ManualJudgeError('item_not_found', 'No item has that id')

  const [mentions, chunks] = await Promise.all([
    db
      .selectFrom('mention')
      .select(['source', 'score', 'num_comments', 'published_at'])
      .where('item_id', '=', itemId)
      .execute(),
    db
      .selectFrom('evidence_chunk')
      .select('text')
      .where('item_id', '=', itemId)
      .orderBy('mention_id')
      .orderBy('chunk_index')
      .execute(),
  ])
  const signals = mentions.map((m) => ({
    source: m.source,
    score: m.score,
    numComments: m.num_comments,
    publishedAt: new Date(m.published_at),
  }))
  const source = primarySource(signals, new Date()) ?? signals[0]?.source
  if (chunks.length === 0 || !source) {
    throw new ManualJudgeError(
      'no_evidence',
      'This item has no stored source text yet, so there is nothing to judge it on',
    )
  }
  return {
    itemId: item.id,
    title: item.title,
    kind: item.kind,
    source,
    itemScore: Math.min(1, Math.max(0, Number(item.score) || 0)),
    requested: false,
    renderedBefore: false,
    inStatusSince: null,
    mentions: signals,
    usableImages: parseItemImages(item.images).filter((img) => img.kind !== 'avatar').length,
    hasDemo: hasDemo(item.demo),
    hasTranscript: youtubeIdFromKey(item.canonical_key) !== null,
    evidence: chunks.map((chunk) => chunk.text),
  }
}

/** Judges one item on demand from its stored evidence and records a `manual`, never-applied decision. Reads only: no status change, no embedding. Ignores gate mode, exemptions and exploration; throws instead of failing open. */
export async function judgeItemManually(
  deps: ManualJudgeDeps,
  itemId: string,
): Promise<GateDecisionRow> {
  const log = deps.log.child({ itemId, mod: 'gate', trigger: 'manual' })
  const item = await loadGateItem(deps.db, itemId)
  const config = await loadGateConfig(deps.db, log)
  const draft = await draftDecision(
    { db: deps.db, log, gate: deps.gate, trigger: 'manual' },
    item,
    { ...config, exploreRate: 0 },
  )
  return recordGateDecision(
    deps.db,
    {
      ...draft,
      itemId,
      // The table only knows shadow and live; a manual judgement changes nothing, which is what shadow means.
      mode: 'shadow',
      applied: false,
      trigger: 'manual',
      promptVersion: GATE_PROMPT_VERSION,
      configHash: await gateConfigHash(config),
    },
    log,
  )
}

/** Maps anything the manual judge can throw to the error code the caller is told. */
export function manualJudgeFailure(err: unknown): { code: ManualJudgeErrorCode; message: string } {
  if (err instanceof ManualJudgeError) return { code: err.code, message: err.message }
  if (err instanceof GateBudgetError) return { code: 'over_budget', message: err.message }
  if (err instanceof QuotaExhaustedError) {
    return {
      code: 'quota_exhausted',
      message: 'The model provider refused the call: quota or billing',
    }
  }
  if (err instanceof GateTimeoutError) return { code: 'judge_timeout', message: err.message }
  if (err instanceof GateJudgeError) return { code: 'judge_failed', message: err.message }
  return { code: 'internal_error', message: 'The judge call failed' }
}

function failure(code: ManualJudgeErrorCode, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status: ERROR_STATUS[code] })
}

function decisionBody(row: GateDecisionRow) {
  return {
    id: row.id,
    itemId: row.item_id,
    verdict: row.verdict,
    score: row.score === null ? null : Number(row.score),
    threshold: Number(row.threshold),
    signals: row.signals,
    reasons: row.reasons,
    rationale: row.rationale,
    decidedBy: row.decided_by,
    rule: row.rule,
    model: row.model,
    costUsd: Number(row.cost_usd),
    trigger: row.trigger,
    mode: row.mode,
    applied: row.applied,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

const bodySchema = z.object({ itemId: z.uuid() })

/** POST body `{ itemId }` -> `{ ok: true, decision }`, or `{ ok: false, error: { code, message } }` with the status for that code. A quota error is reported, never turned into a pipeline pause. */
export async function handleManualJudge(
  request: Request,
  deps: ManualJudgeDeps,
): Promise<Response> {
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success)
    return failure('invalid_request', 'Send a JSON body with the item id as itemId')
  try {
    const row = await judgeItemManually(deps, body.data.itemId)
    return Response.json({ ok: true, decision: decisionBody(row) })
  } catch (err) {
    const { code, message } = manualJudgeFailure(err)
    deps.log.warn(
      { itemId: body.data.itemId, code, ...errorFields(err) },
      'manual gate judge failed',
    )
    return failure(code, message)
  }
}
