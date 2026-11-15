import { describe, expect, it, vi } from 'vitest'

vi.mock('@/server/admin/instagram', () => ({ livePostPermalink: vi.fn() }))
vi.mock('@/server/admin/pipeline-queries', () => ({ itemDetail: vi.fn() }))

const { toItemDrawerData } = await import('./drawer-data')

type Detail = Parameters<typeof toItemDrawerData>[0]

const detail = {
  item: {
    id: 'i1',
    title: 'A repo',
    source: 'github',
    status: 'failed',
    attempts: 2,
    first_seen_at: new Date('2026-01-01T00:00:00Z'),
    canonical_url: 'https://github.com/a/b',
    visibility: 'public',
    hidden_reason: null,
    hidden_at: null,
    last_error: 'boom',
    last_ok_stage: 'voiced',
    tldr: 'short',
    script: { hook: 'not a valid script' },
  },
  events: [
    {
      stage: 'found',
      outcome: 'ok',
      attempt: 1,
      duration_ms: 50,
      error: null,
      meta: null,
      id: 1,
      created_at: new Date('2026-01-01T00:00:01Z'),
    },
  ],
  renders: [
    {
      status: 'done',
      attempts: 1,
      template_version: 7,
      render_ms: 1000,
      video_duration_ms: 30000,
      bytes: 10,
      video_key: 'v/a.mp4',
      poster_key: 'v/a.jpg',
    },
  ],
  spend: [
    { category: 'llm', cost_usd: '0.0100', meta: { model: 'sonnet' } },
    { category: 'tts', cost_usd: '0.0200', meta: { provider: 'edge' } },
  ],
} as unknown as Detail

describe('toItemDrawerData', () => {
  const data = toItemDrawerData(detail, {
    mediaBase: 'https://media.test/',
    permalink: 'https://instagram.com/p/x',
    now: new Date('2026-01-02T00:00:00Z'),
  })

  it('serializes dates as ISO strings and keeps the suggested retry stage', () => {
    expect(data.item.firstSeenAt).toBe('2026-01-01T00:00:00.000Z')
    expect(data.events[0]?.created_at).toBe('2026-01-01T00:00:01.000Z')
    expect(data.retryStage).toBe('embedded')
    expect(data.now).toBe('2026-01-02T00:00:00.000Z')
  })

  it('drops an invalid script instead of failing', () => {
    expect(data.script).toBeNull()
  })

  it('builds media urls and totals spend', () => {
    expect(data.video).toEqual({
      url: 'https://media.test/v/a.mp4',
      posterUrl: 'https://media.test/v/a.jpg',
    })
    expect(data.totalUsd).toBeCloseTo(0.03)
    expect(data.spend.map((s) => s.label)).toEqual(['sonnet', 'edge'])
    expect(data.narrationProvider).toBe('edge')
    expect(data.postedPermalink).toBe('https://instagram.com/p/x')
  })

  it('never exposes raw event meta or render keys', () => {
    const json = JSON.stringify(data)
    expect(json).not.toContain('render_key')
    expect(json).not.toContain('"meta"')
  })

  it('has no gate block for an item the gate never judged', () => {
    expect(data.gate).toBeNull()
  })
})

describe('toItemDrawerData gate block', () => {
  const gate = {
    id: 'g1',
    item_id: 'i1',
    verdict: 'source_only',
    score: 38,
    threshold: 55,
    signals: { hook: 3, visual: 2, secret: 1 },
    reasons: ['routine release'],
    rationale: 'A version bump.',
    decided_by: 'model',
    rule: null,
    mode: 'live',
    applied: true,
    model: 'claude-haiku-5-5',
    prompt_version: 'gate-v1',
    config_hash: 'cfg-hash-1',
    cost_usd: 0.002,
    label: 'disagree',
    label_reason: 'actually_interesting',
    label_note: 'big launch',
    labeled_by: 'admin-uuid-1',
    labeled_at: new Date('2026-01-01T02:00:00Z'),
    created_at: new Date('2026-01-01T01:00:00Z'),
  } as unknown as NonNullable<Parameters<typeof toItemDrawerData>[1]['gate']>

  const data = toItemDrawerData(detail, {
    mediaBase: 'https://media.test/',
    permalink: null,
    now: new Date('2026-01-02T00:00:00Z'),
    gate,
  })

  it('projects the decision, its signals and the admin label', () => {
    expect(data.gate).toMatchObject({
      decisionId: 'g1',
      itemId: 'i1',
      verdict: 'source_only',
      score: 38,
      threshold: 55,
      reasons: ['routine release'],
      rationale: 'A version bump.',
      decidedBy: 'model',
      mode: 'live',
      applied: true,
      model: 'claude-haiku-5-5',
      promptVersion: 'gate-v1',
      decidedAt: '2026-01-01T01:00:00.000Z',
      label: 'disagree',
      labelReason: 'Actually interesting',
      labelNote: 'big launch',
    })
    expect(data.gate?.signals).toHaveLength(6)
    expect(data.gate?.signals[0]).toEqual({ key: 'hook', label: 'Hook', value: 3, pct: 30 })
    expect(data.gate?.disagreeReasons.map((r) => r.key)).toEqual([
      'actually_interesting',
      'strong_visuals_missed',
      'other',
    ])
  })

  it('exposes only the projected gate fields', () => {
    const json = JSON.stringify(data.gate)
    expect(json).not.toContain('cfg-hash-1')
    expect(json).not.toContain('admin-uuid-1')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('cost')
  })
})
