import { describe, expect, it } from 'vitest'
import { requestSteps, type RequestStepsInput } from './request-steps'

const base: RequestStepsInput = {
  requestStatus: 'processing',
  requestCreatedAt: '2026-11-15T10:00:00Z',
  itemStatus: 'found',
  renderStatus: null,
  events: [],
}
const states = (input: Partial<RequestStepsInput>) =>
  requestSteps({ ...base, ...input }).map((s) => s.state)

describe('requestSteps', () => {
  it('has the five labelled steps in order', () => {
    expect(requestSteps(base).map((s) => s.key)).toEqual([
      'queued',
      'reading',
      'script',
      'render',
      'ready',
    ])
  })
  it('is queued while pending and reading while resolving', () => {
    expect(states({ requestStatus: 'pending', itemStatus: null })).toEqual([
      'active',
      'todo',
      'todo',
      'todo',
      'todo',
    ])
    expect(states({ requestStatus: 'resolving', itemStatus: null })).toEqual([
      'done',
      'active',
      'todo',
      'todo',
      'todo',
    ])
  })
  it('follows the item status while processing', () => {
    expect(states({ itemStatus: 'found' })).toEqual(['done', 'done', 'active', 'todo', 'todo'])
    expect(states({ itemStatus: 'embedded' })).toEqual(['done', 'done', 'done', 'active', 'todo'])
    expect(states({ itemStatus: 'rendered', renderStatus: 'rendering' })).toEqual([
      'done',
      'done',
      'done',
      'active',
      'todo',
    ])
  })
  it('is all done with timestamps from item events', () => {
    const steps = requestSteps({
      ...base,
      requestStatus: 'done',
      itemStatus: 'rendered',
      renderStatus: 'done',
      events: [
        { stage: 'found', outcome: 'started', createdAt: '2026-11-15T10:01:00Z' },
        { stage: 'summarized', outcome: 'ok', createdAt: new Date('2026-11-15T10:02:00Z') },
        { stage: 'rendered', outcome: 'ok', createdAt: '2026-11-15T10:05:00Z' },
      ],
    })
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(steps[1]?.at).toBe('2026-11-15T10:01:00.000Z')
    expect(steps[2]?.at).toBe('2026-11-15T10:02:00.000Z')
    expect(steps[4]?.at).toBe('2026-11-15T10:05:00.000Z')
  })
  it('marks the failing step and leaves later ones todo', () => {
    expect(states({ requestStatus: 'failed', itemStatus: 'insufficient_source' })).toEqual([
      'done',
      'failed',
      'todo',
      'todo',
      'todo',
    ])
    expect(states({ requestStatus: 'failed', itemStatus: null })).toEqual([
      'done',
      'failed',
      'todo',
      'todo',
      'todo',
    ])
    expect(
      states({ requestStatus: 'failed', itemStatus: 'failed', renderStatus: 'failed' }),
    ).toEqual(['done', 'done', 'done', 'failed', 'todo'])
    expect(
      states({
        requestStatus: 'failed',
        itemStatus: 'failed',
        events: [{ stage: 'found', outcome: 'failed', createdAt: '2026-11-15T10:01:00Z' }],
      }),
    ).toEqual(['done', 'done', 'failed', 'todo', 'todo'])
  })
})
