import { vi } from 'vitest'
import { GATE_SIGNAL_KEYS } from '@reelset/core'
import type { GateItem } from '../../src/pipeline/gate'
import type { LlmRequest } from '../../src/pipeline/output'
import type { RecordedQuery } from './fake-db'

type Row = Record<string, unknown>

export type GateWorld = {
  /** app_setting rows by key, for example { gate_mode: 'live' }. */
  settings: Record<string, unknown>
  latest: Row | null
  /** Older decision rows, oldest first, for tests that need more than one. */
  history?: Row[]
  examples: Row[]
  recorded: Row[]
  /** A query containing this fragment throws, to simulate a database failure. */
  failOn?: string
}

export function makeGateWorld(overrides: Partial<GateWorld> = {}): GateWorld {
  return {
    settings: { gate_mode: 'live', gate_explore_rate: 0 },
    latest: null,
    examples: [],
    recorded: [],
    ...overrides,
  }
}

function insertedRow(q: RecordedQuery, id: string): Row {
  const columns = [...q.sql.slice(0, q.sql.indexOf(' values ')).matchAll(/"(\w+)"/g)]
    .map((m) => m[1]!)
    .slice(1)
  const row: Row = { id, created_at: new Date() }
  columns.forEach((column, index) => (row[column] = q.params[index]))
  return row
}

/** Answers the gate's queries (settings, latest decision, examples, decision insert) from a GateWorld. */
export function gateQueries(world: GateWorld) {
  return (q: RecordedQuery): unknown[] | undefined => {
    if (world.failOn && q.sql.includes(world.failOn)) throw new Error('database unavailable')
    if (q.sql.includes('from "app_setting"') && q.sql.includes('"key" in')) {
      return Object.entries(world.settings).map(([key, value]) => ({ key, value }))
    }
    if (q.sql.includes('with labelled')) return world.examples
    if (q.sql.startsWith('insert into "gate_decision"')) {
      const row = insertedRow(q, `dec-${world.recorded.length + 1}`)
      world.recorded.push(row)
      return [row]
    }
    if (q.sql.includes('from "gate_decision"')) {
      const rows = [
        ...(world.history ?? []),
        ...(world.latest ? [world.latest] : []),
        ...world.recorded,
      ]
      const visible = q.sql.includes('"trigger" =')
        ? rows.filter((row) => (row.trigger ?? 'auto') === 'auto')
        : rows
      const latest = visible.at(-1)
      return latest ? [latest] : []
    }
    return undefined
  }
}

/** A judge answer that gives every signal the same mark. */
export function judgeAnswer(mark: number, extra: Row = {}): string {
  return JSON.stringify({
    signals: Object.fromEntries(GATE_SIGNAL_KEYS.map((key) => [key, mark])),
    reasons: ['concrete speedup number', 'clear demo'],
    rationale: 'It has a checkable result and something to show.',
    ...extra,
  })
}

export const NEVER_ANSWERS = Symbol('never answers')
export type JudgeUsage = { inputTokens: number; outputTokens: number }

export function makeJudge(
  outputs: (string | Error | typeof NEVER_ANSWERS)[],
  usage: JudgeUsage = { inputTokens: 2000, outputTokens: 300 },
) {
  const generate = vi.fn(async (_req: LlmRequest) => {
    const next = outputs.shift()
    if (next === undefined) throw new Error('judge called more often than scripted')
    if (next === NEVER_ANSWERS) return new Promise<never>(() => {})
    if (next instanceof Error) throw next
    return { text: next, usage }
  })
  const judge = vi.fn(() => ({ generate }))
  return { judge, generate }
}

export function gateItem(overrides: Partial<GateItem> = {}): GateItem {
  return {
    itemId: 'item-1',
    title: 'acme/repo',
    kind: 'repo',
    source: 'github',
    itemScore: 0.8,
    requested: false,
    renderedBefore: false,
    inStatusSince: null,
    mentions: [{ source: 'github', score: 1200, numComments: 30 }],
    usableImages: 2,
    hasDemo: true,
    hasTranscript: false,
    evidence: ['A fast queue library for Cloudflare Workers.', 'Retries are built in.'],
    ...overrides,
  }
}

export function gateExampleRow(index: number, overrides: Row = {}): Row {
  return {
    id: `ex-${index}`,
    item_id: `ex-item-${index}`,
    title: `Example source ${index}`,
    canonical_url: `https://example.com/${index}`,
    source: 'hn',
    verdict: 'source_only',
    decided_by: 'model',
    label: 'disagree',
    label_reason: 'strong_visuals_missed',
    label_note: null,
    score: 40,
    labeled_at: new Date(Date.UTC(2026, 10, 1 + index)),
    ...overrides,
  }
}
