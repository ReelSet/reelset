import { elapsedMs, errorFields, type AskOutcome, type Logger } from '@reelset/core'
import type { CitationDto } from '@/lib/api-types'
import type { GeneratedAnswer } from './answer-stream'
import { filterCitations, selectEvidence, type EvidenceChunk } from './evidence'
import { decideSpendGate } from './gate'
import { embeddingCostUsd, estimateTokens, llmCostUsd, type AskSpendKind } from './pricing'
import { isProviderUnavailable } from './provider-error'
import type { QuestionCheck } from './question'

export const NO_EVIDENCE_MESSAGE =
  'Not enough evidence yet. Nothing collected so far answers that well; try again after more stories land.'
export const RATE_LIMITED_MESSAGE = 'You have asked a lot this hour. Please try again a bit later.'
export const SPEND_CAPPED_MESSAGE =
  'Ask is paused for today to keep costs in check. Try again tomorrow.'
export const AI_UNAVAILABLE_MESSAGE =
  'AI is temporarily unavailable. Your question was not lost; please try again in a little while.'
export const ERROR_MESSAGE = 'Something went wrong while answering. Please try again.'

export type CachedAnswer = { answer: string; citations: CitationDto[] }

export type AskLogEntry = {
  profileId: string
  question: string
  normalized: string
  outcome: AskOutcome
  answer: string | null
  citations: CitationDto[] | null
  latencyMs: number
  inputTokens: number | null
  outputTokens: number | null
  conversationId: string | null
  cached: boolean
}

export type AskDeps = {
  log: Logger
  limits(): Promise<{ hourlyLimit: number; dailyCapUsd: number }>
  spentTodayUsd(): Promise<number>
  /**
   * Atomically checks the hourly limit and inserts a placeholder ask_query row, so concurrent
   * requests from one user cannot all pass the check. Returns the row id, or null when over limit.
   */
  reserveAsk(input: {
    profileId: string
    question: string
    normalized: string
    hourlyLimit: number
    conversationId: string | null
  }): Promise<string | null>
  findCached(normalized: string): Promise<CachedAnswer | null>
  embed(text: string): Promise<number[]>
  retrieve(embedding: number[]): Promise<EvidenceChunk[]>
  generate(
    question: string,
    chunks: EvidenceChunk[],
    onText: (text: string) => void,
  ): Promise<GeneratedAnswer>
  recordSpend(kind: AskSpendKind, units: number, costUsd: number): Promise<void>
  logQuery(entry: AskLogEntry): Promise<void>
  completeQuery(reservationId: string, entry: AskLogEntry): Promise<void>
}

export type AskResult =
  | { outcome: 'answered'; answer: string; citations: CitationDto[]; cached: boolean }
  | { outcome: 'no_evidence' | 'rate_limited' | 'spend_capped'; message: string }
  | { outcome: 'error'; message: string; reason?: 'ai_unavailable' }

export async function runAsk(
  deps: AskDeps,
  input: {
    profileId: string
    check: Extract<QuestionCheck, { ok: true }>
    conversationId?: string | null
  },
  onText: (text: string) => void = () => undefined,
): Promise<AskResult> {
  const started = performance.now()
  const { question, normalized } = input.check
  const log = deps.log.child({ fn: 'runAsk', profileId: input.profileId })

  let reservationId: string | null = null

  const finish = async (
    result: AskResult,
    extra: Partial<
      Pick<AskLogEntry, 'answer' | 'citations' | 'inputTokens' | 'outputTokens' | 'cached'>
    > = {},
  ): Promise<AskResult> => {
    const latencyMs = elapsedMs(started)
    try {
      const entry: AskLogEntry = {
        profileId: input.profileId,
        question,
        normalized,
        outcome: result.outcome,
        answer: null,
        citations: null,
        inputTokens: null,
        outputTokens: null,
        conversationId: input.conversationId ?? null,
        cached: false,
        ...extra,
        latencyMs,
      }
      if (reservationId) await deps.completeQuery(reservationId, entry)
      else await deps.logQuery(entry)
    } catch (err) {
      log.error(errorFields(err), 'ask_query insert failed')
    }
    log.info({ outcome: result.outcome, latencyMs }, 'ask finished')
    return result
  }

  try {
    const [{ hourlyLimit, dailyCapUsd }, spentTodayUsd] = await Promise.all([
      deps.limits(),
      deps.spentTodayUsd(),
    ])
    const gate = decideSpendGate({ spentTodayUsd, dailyCapUsd })
    log.info({ gate, spentTodayUsd, dailyCapUsd }, 'ask spend gate decided')
    if (gate === 'spend_capped')
      return finish({ outcome: 'spend_capped', message: SPEND_CAPPED_MESSAGE })

    reservationId = await deps.reserveAsk({
      profileId: input.profileId,
      question,
      normalized,
      hourlyLimit,
      conversationId: input.conversationId ?? null,
    })
    log.info({ reserved: reservationId !== null, hourlyLimit }, 'ask rate limit decided')
    if (!reservationId) return finish({ outcome: 'rate_limited', message: RATE_LIMITED_MESSAGE })

    const cached = await deps.findCached(normalized)
    if (cached) {
      log.info('ask served from cache')
      // Stored with cached=true so it shows in history but never refreshes the cache window.
      return finish(
        { outcome: 'answered', ...cached, cached: true },
        { answer: cached.answer, citations: cached.citations, cached: true },
      )
    }

    const embedding = await deps.embed(normalized)
    await deps.recordSpend(
      'embedding',
      estimateTokens(normalized),
      embeddingCostUsd(estimateTokens(normalized)),
    )

    const evidence = selectEvidence(await deps.retrieve(embedding))
    log.info({ evidence: evidence.length }, 'evidence retrieved')
    if (evidence.length === 0)
      return finish({ outcome: 'no_evidence', message: NO_EVIDENCE_MESSAGE })

    const generated = await deps.generate(question, evidence, onText)
    await deps.recordSpend(
      'llm',
      generated.inputTokens + generated.outputTokens,
      llmCostUsd(generated.inputTokens, generated.outputTokens),
    )
    const tokens = { inputTokens: generated.inputTokens, outputTokens: generated.outputTokens }

    if (!generated.parsed) {
      log.warn('model returned invalid JSON')
      return finish({ outcome: 'error', message: ERROR_MESSAGE }, tokens)
    }

    const citations = filterCitations(generated.parsed.citations, evidence)
    const dropped = generated.parsed.citations.length - citations.length
    if (dropped > 0) log.warn({ dropped }, 'citations outside retrieved set dropped')
    const answer = generated.parsed.answer.trim()
    if (!answer || citations.length === 0) {
      log.info('answer empty or uncited, treated as no evidence')
      return finish({ outcome: 'no_evidence', message: NO_EVIDENCE_MESSAGE }, tokens)
    }

    return finish(
      { outcome: 'answered', answer, citations, cached: false },
      { ...tokens, answer, citations },
    )
  } catch (err) {
    log.error(errorFields(err), 'ask failed')
    if (isProviderUnavailable(err)) {
      return finish({ outcome: 'error', message: AI_UNAVAILABLE_MESSAGE, reason: 'ai_unavailable' })
    }
    return finish({ outcome: 'error', message: ERROR_MESSAGE })
  }
}
