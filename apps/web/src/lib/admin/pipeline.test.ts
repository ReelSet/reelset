import { describe, expect, it } from 'vitest'
import {
  activeStepKey,
  buildTimeline,
  describeError,
  etaHint,
  relativeTime,
  shortDuration,
  stepperFor,
} from './pipeline'

const states = (status: string, lastOk?: string) => stepperFor(status, lastOk).map((s) => s.state)

describe('stepperFor', () => {
  it('highlights the step after the finished stage', () => {
    expect(states('found')).toEqual(['done', 'active', 'pending', 'pending', 'pending'])
    expect(states('summarized')).toEqual(['done', 'done', 'active', 'pending', 'pending'])
    expect(states('embedded')).toEqual(['done', 'done', 'done', 'active', 'pending'])
    expect(states('voiced')).toEqual(['done', 'done', 'done', 'active', 'pending'])
  })

  it('marks a rendered item as fully done', () => {
    expect(states('rendered')).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('shows where a failed item stopped', () => {
    expect(states('failed', 'embedded')).toEqual(['done', 'done', 'done', 'failed', 'pending'])
    expect(states('failed', 'summarized')).toEqual(['done', 'done', 'failed', 'pending', 'pending'])
    expect(states('failed')).toEqual(['done', 'failed', 'pending', 'pending', 'pending'])
  })

  it('names the active step', () => {
    expect(activeStepKey('found')).toBe('script')
    expect(activeStepKey('embedded')).toBe('render')
    expect(activeStepKey('rendered')).toBeNull()
    expect(activeStepKey('failed')).toBeNull()
  })
})

describe('durations and eta', () => {
  it('formats short durations', () => {
    expect(shortDuration(4_200)).toBe('4s')
    expect(shortDuration(125_000)).toBe('2m 05s')
    expect(shortDuration(3_700_000)).toBe('1h 01m')
    expect(shortDuration(-1)).toBe('-')
  })

  it('formats relative time', () => {
    const now = new Date('2026-11-11T12:00:00Z')
    expect(relativeTime('2026-11-11T11:59:58Z', now)).toBe('just now')
    expect(relativeTime('2026-11-11T11:55:00Z', now)).toBe('5m 00s ago')
    expect(relativeTime(null, now)).toBe('-')
  })

  it('estimates from medians and flags slow steps', () => {
    const medians = { summarized: 30_000 }
    expect(etaHint('script', 10_000, medians)).toEqual({ kind: 'normal', label: '~20s left' })
    expect(etaHint('script', 28_000, medians)?.label).toBe('finishing up')
    expect(etaHint('script', 90_000, medians)?.kind).toBe('slow')
    expect(etaHint('embed', 1_000, medians)).toBeNull()
  })
})

describe('describeError', () => {
  it('maps known codes to plain words', () => {
    expect(describeError('stuck_timeout')?.summary).toMatch(/too long/)
    expect(describeError('stuck in embedded after 3 attempts')?.summary).toMatch(/too long/)
    expect(describeError('generation rejected: response was not valid JSON')?.summary).toMatch(
      /AI script/,
    )
    expect(describeError('HTTP 402 payment required')?.summary).toMatch(/quota/)
    expect(describeError('busy')?.summary).toMatch(/busy/)
    expect(describeError('invalid_input')?.hint).toBeTruthy()
  })

  it('passes unknown errors through, truncated, and handles empty', () => {
    expect(describeError('weird failure')?.summary).toBe('weird failure')
    expect(describeError('x'.repeat(500))?.summary).toHaveLength(140)
    expect(describeError(null)).toBeNull()
  })
})

describe('buildTimeline', () => {
  it('places timed events by their end minus duration', () => {
    const t = buildTimeline([
      {
        stage: 'found',
        outcome: 'started',
        attempt: 1,
        duration_ms: null,
        error: null,
        created_at: '2026-11-11T10:00:00Z',
      },
      {
        stage: 'summarized',
        outcome: 'ok',
        attempt: 1,
        duration_ms: 30_000,
        error: null,
        created_at: '2026-11-11T10:05:00Z',
      },
      {
        stage: 'embedded',
        outcome: 'ok',
        attempt: 1,
        duration_ms: 1_000,
        error: null,
        created_at: '2026-11-11T10:06:00Z',
      },
    ])
    expect(t.bars.map((b) => b.label)).toEqual(['summarized', 'embedded'])
    expect(t.bars[0]?.startMs).toBe(270_000)
    expect(t.totalMs).toBe(360_000)
    expect(t.startedAt).toBe('2026-11-11T10:00:00.000Z')
  })

  it('is empty without events', () => {
    expect(buildTimeline([])).toEqual({ bars: [], totalMs: 0, startedAt: null })
  })
})
