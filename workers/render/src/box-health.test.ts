import { describe, expect, it, vi } from 'vitest'
import {
  isBoxDownResponse,
  parseBoxHealth,
  sampleBoxes,
  type BoxSampleRow,
  type BoxSampleStore,
} from './box-health'
import { silentLog } from './testing'

describe('isBoxDownResponse', () => {
  it('reads a non-JSON 502/503/504/530 as down', () => {
    for (const status of [502, 503, 504, 530]) {
      expect(isBoxDownResponse(new Response('x', { status }))).toBe(true)
    }
    expect(isBoxDownResponse(Response.json({ reason: 'x' }, { status: 502 }))).toBe(false)
    expect(isBoxDownResponse(new Response('x', { status: 500 }))).toBe(false)
  })
})

describe('parseBoxHealth', () => {
  it('parses the full payload', () => {
    expect(
      parseBoxHealth({
        ok: true,
        box: 'box1',
        running: 1,
        inflight: 2,
        idleSeconds: 5,
        cpuPct: 42.5,
        load1: 0.7,
        memUsedMb: 600,
        swapUsedMb: 10,
      }),
    ).toEqual({
      box: 'box1',
      running: 1,
      inflight: 2,
      idleSeconds: 5,
      cpuPct: 42.5,
      load1: 0.7,
      memUsedMb: 600,
      swapUsedMb: 10,
    })
  })

  it('accepts the old shape with nulls for the new fields', () => {
    expect(parseBoxHealth({ ok: true, running: 0, inflight: 0, idleSeconds: 5 })).toEqual({
      box: null,
      running: 0,
      inflight: 0,
      idleSeconds: 5,
      cpuPct: null,
      load1: null,
      memUsedMb: null,
      swapUsedMb: null,
    })
  })

  it('rejects unreadable bodies', () => {
    expect(parseBoxHealth({ ok: true, running: 0 })).toBeNull()
    expect(parseBoxHealth('x')).toBeNull()
  })
})

function fakeStore(failFor?: string) {
  const rows: BoxSampleRow[] = []
  const store: BoxSampleStore = {
    async insertBoxSample(row) {
      if (row.box === failFor) throw new Error('db down')
      rows.push(row)
    },
  }
  return { rows, store }
}

describe('sampleBoxes', () => {
  const urls = ['https://box1.example.test', 'https://box2.example.test']

  it('stores one row per box using the reported box name', async () => {
    const { rows, store } = fakeStore()
    const fetchMock = vi.fn(async (url: URL) =>
      Response.json({
        ok: true,
        box: url.host.startsWith('box1') ? 'oracle-1' : 'oracle-2',
        running: 1,
        inflight: 1,
        idleSeconds: 3,
        cpuPct: 55,
        load1: 1.1,
        memUsedMb: 700,
        swapUsedMb: 0,
      }),
    )
    await sampleBoxes({ urls, store, log: silentLog, fetch: fetchMock as unknown as typeof fetch })
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://box1.example.test/health',
      'https://box2.example.test/health',
    ])
    expect(rows.map((r) => r.box)).toEqual(['oracle-1', 'oracle-2'])
    expect(rows[0]).toMatchObject({ ok: true, running: 1, cpu_pct: 55, mem_used_mb: 700 })
  })

  it('records an unreachable box as ok=false under its host', async () => {
    const { rows, store } = fakeStore()
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.host.startsWith('box1')) throw new TypeError('refused')
      return Response.json({ box: 'b2', running: 0, inflight: 0, idleSeconds: 1 })
    })
    await sampleBoxes({ urls, store, log: silentLog, fetch: fetchMock as unknown as typeof fetch })
    expect(rows[0]).toMatchObject({
      box: 'box1.example.test',
      ok: false,
      idle_seconds: null,
      cpu_pct: null,
    })
    expect(rows[1]).toMatchObject({ box: 'b2', ok: true })
  })

  it('treats a non-OK or unreadable answer as down', async () => {
    const { rows, store } = fakeStore()
    const fetchMock = vi.fn(async () => new Response('x', { status: 530 }))
    await sampleBoxes({ urls, store, log: silentLog, fetch: fetchMock as unknown as typeof fetch })
    expect(rows.every((r) => !r.ok)).toBe(true)
  })

  it('keeps sampling the other boxes when one insert fails', async () => {
    const { rows, store } = fakeStore('box1.example.test')
    const fetchMock = vi.fn(async () => new Response('x', { status: 530 }))
    await sampleBoxes({ urls, store, log: silentLog, fetch: fetchMock as unknown as typeof fetch })
    expect(rows.map((r) => r.box)).toEqual(['box2.example.test'])
  })
})
