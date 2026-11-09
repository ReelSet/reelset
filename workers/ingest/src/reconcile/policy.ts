import type { ItemStatus } from '@reelset/core'
import { MAX_STUCK_ATTEMPTS, STUCK_AFTER_MS } from '../config'

export type AdmissionInput = {
  score: number
  minScore: number
  admittedToday: number
  dailyCap: number
  spendTodayUsd: number
  spendCapUsd: number
}

export type AdmissionDecision =
  { admit: true } | { admit: false; reason: 'below_score' | 'daily_cap' | 'spend_cap' }

export function admissionDecision(input: AdmissionInput): AdmissionDecision {
  if (input.score < input.minScore) return { admit: false, reason: 'below_score' }
  if (input.admittedToday >= input.dailyCap) return { admit: false, reason: 'daily_cap' }
  if (input.spendTodayUsd >= input.spendCapUsd) return { admit: false, reason: 'spend_cap' }
  return { admit: true }
}

export type Candidate = { id: string; score: number; source: string }

// Fills each slot from the source that has been admitted least today (ties: highest head score),
// so one source cannot starve the others. Candidates below minScore keep their score order at the end.
export function interleaveBySource<T extends Candidate>(
  candidates: readonly T[],
  admittedBySource: ReadonlyMap<string, number>,
  minScore: number,
): T[] {
  const queues = new Map<string, T[]>()
  const rest: T[] = []
  for (const c of [...candidates].sort((a, b) => b.score - a.score)) {
    if (c.score < minScore) {
      rest.push(c)
      continue
    }
    const queue = queues.get(c.source) ?? []
    queue.push(c)
    queues.set(c.source, queue)
  }
  const taken = new Map(admittedBySource)
  const out: T[] = []
  while (queues.size > 0) {
    let pick: string | null = null
    for (const [source, queue] of queues) {
      if (pick === null) pick = source
      else {
        const a = taken.get(source) ?? 0
        const b = taken.get(pick) ?? 0
        if (a < b || (a === b && queue[0]!.score > queues.get(pick)![0]!.score)) pick = source
      }
    }
    const queue = queues.get(pick!)!
    out.push(queue.shift()!)
    taken.set(pick!, (taken.get(pick!) ?? 0) + 1)
    if (queue.length === 0) queues.delete(pick!)
  }
  return [...out, ...rest]
}

export type StuckInput = {
  status: ItemStatus
  queuedAt: Date | null
  statusChangedAt: Date
  attempts: number
}

export type StuckDecision = 'ok' | 'requeue' | 'fail'

export function classifyStuck(item: StuckInput, now: Date): StuckDecision {
  const watched: ItemStatus[] = ['found', 'summarized', 'embedded', 'voiced']
  if (!watched.includes(item.status)) return 'ok'
  if (!item.queuedAt) return 'ok'
  const cutoff = now.getTime() - STUCK_AFTER_MS
  if (item.queuedAt.getTime() >= cutoff) return 'ok'
  if (item.statusChangedAt.getTime() >= cutoff) return 'ok'
  return item.attempts + 1 >= MAX_STUCK_ATTEMPTS ? 'fail' : 'requeue'
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
