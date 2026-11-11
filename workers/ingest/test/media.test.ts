import { describe, expect, it, vi } from 'vitest'
import { createLogger, type ItemImage } from '@reelset/core'
import { captureRepoDemo, extractReadmeDemos, kindOfType, type DemoFetchers } from '../src/demo'
import {
  applyVerdict,
  createClaudeVetter,
  normalizeVet,
  urlHash,
  vetImages,
  type VetCache,
  type VetResult,
} from '../src/pipeline/image-vet'
import { QuotaExhaustedError } from '../src/pipeline/quota'
import { repairBroll, repairShots, numberValues } from '../src/pipeline/shots'

const log = createLogger({ app: 'test', level: 'silent' })

describe('stat label repair (MOPD)', () => {
  const text =
    'P^2-MOPD recovers 52.8% of the gap on AIME, 59.7% on HMMT and 85.0% on math. Across tasks it reaches 94.7% average recovery.'
  const facts = numberValues(text)
  const slam = (value: string, cue: string) => ({
    at: cue,
    show: 'StatSlam',
    props: { value, label: 'AVERAGE RECOVERY' },
  })

  it('never keeps one label on four different numbers', () => {
    const beat: Record<string, unknown> = {
      text,
      shots: [
        slam('52.8%', 'recovers'),
        slam('59.7%', 'HMMT'),
        slam('85.0%', 'math'),
        slam('94.7%', 'reaches'),
      ],
    }
    repairShots(beat, facts)
    const labels = (beat.shots as { props: { label: string } }[]).map((s) =>
      s.props.label.toLowerCase(),
    )
    expect(labels.filter((l) => l === 'average recovery')).toHaveLength(1)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('shares the ledger across beats so a label is not reused later', () => {
    const ledger = new Map<string, number>()
    const a: Record<string, unknown> = {
      text: 'It hits 94.7% average recovery.',
      shots: [slam('94.7%', 'hits')],
    }
    const b: Record<string, unknown> = {
      text: 'Another run gets 85.0% average recovery.',
      shots: [slam('85.0%', 'gets')],
    }
    repairShots(a, numberValues('94.7 85.0'), ledger)
    repairShots(b, numberValues('94.7 85.0'), ledger)
    const first = (a.shots as { props: { label: string } }[])[0]!.props.label.toLowerCase()
    const second = (
      b.shots as { props: { label: string } }[] | undefined
    )?.[0]?.props.label.toLowerCase()
    expect(first).toBe('average recovery')
    expect(second).not.toBe('average recovery')
  })

  it('drops a BarRace without two grounded labels', () => {
    const beat: Record<string, unknown> = {
      text: 'A scores 52.8% and B scores 59.7%.',
      shots: [
        {
          at: 'scores',
          show: 'BarRace',
          props: {
            bars: [
              { label: 'A', value: '52.8%' },
              { label: 'B', value: '59.7%' },
            ],
          },
        },
      ],
    }
    repairShots(beat, numberValues('52.8 59.7'))
    const bars = (beat.shots as { props: { bars: { label: string }[] } }[] | undefined)?.[0]?.props
      .bars
    if (bars) expect(new Set(bars.map((b) => b.label)).size).toBe(bars.length)
  })
})

describe('repairBroll', () => {
  it('keeps at most two lowercase abstract phrases', () => {
    const beat: Record<string, unknown> = {
      broll: ['server room', 'PyTorch', 'circuit board', 'data center'],
    }
    repairBroll(beat)
    expect(beat.broll).toEqual(['server room', 'circuit board'])
  })
  it('removes junk', () => {
    const beat: Record<string, unknown> = { broll: 'nope' }
    repairBroll(beat)
    expect(beat.broll).toBeUndefined()
  })
})

const README = `
# Widget
[![Build](https://img.shields.io/badge/build-passing-green.svg)](https://ci.example.com)
![logo](https://raw.githubusercontent.com/acme/widget/HEAD/assets/logo.gif)
## Demo
https://github.com/user-attachments/assets/12345678-aaaa-bbbb-cccc-1234567890ab

![demo](docs/demo.gif)
<video src="https://github.com/acme/widget/raw/main/media/demo.mp4" controls></video>
![other host](https://example.com/anim.gif)
`

describe('extractReadmeDemos', () => {
  const found = extractReadmeDemos(README, 'acme', 'widget')

  it('finds attachments, repo gifs and video tags in reading order', () => {
    expect(found.map((f) => f.url)).toEqual([
      'https://github.com/user-attachments/assets/12345678-aaaa-bbbb-cccc-1234567890ab',
      'https://raw.githubusercontent.com/acme/widget/HEAD/docs/demo.gif',
      'https://raw.githubusercontent.com/acme/widget/main/media/demo.mp4',
    ])
  })

  it('skips badges, logos and foreign hosts', () => {
    expect(found.some((f) => /logo|shields|example\.com/.test(f.url))).toBe(false)
  })
})

describe('captureRepoDemo', () => {
  const fetchers = (
    probes: Record<string, { type: string; bytes: number | null } | null>,
  ): DemoFetchers => ({
    readme: async () => README,
    probe: async (url) => probes[url] ?? null,
  })

  it('prefers a video over a gif', async () => {
    const demo = await captureRepoDemo(
      'acme',
      'widget',
      fetchers({
        'https://raw.githubusercontent.com/acme/widget/HEAD/docs/demo.gif': {
          type: 'image/gif',
          bytes: 500_000,
        },
        'https://github.com/user-attachments/assets/12345678-aaaa-bbbb-cccc-1234567890ab': {
          type: 'video/mp4',
          bytes: 3_000_000,
        },
      }),
      log,
    )
    expect(demo).toMatchObject({ kind: 'mp4', bytes: 3_000_000 })
  })

  it('takes a gif when there is no video and skips files over 20 MB or tiny gifs', async () => {
    const big = await captureRepoDemo(
      'acme',
      'widget',
      fetchers({
        'https://github.com/user-attachments/assets/12345678-aaaa-bbbb-cccc-1234567890ab': {
          type: 'video/mp4',
          bytes: 30_000_000,
        },
        'https://raw.githubusercontent.com/acme/widget/HEAD/docs/demo.gif': {
          type: 'image/gif',
          bytes: 1_000_000,
        },
      }),
      log,
    )
    expect(big).toMatchObject({ kind: 'gif' })
    const tiny = await captureRepoDemo(
      'acme',
      'widget',
      fetchers({
        'https://raw.githubusercontent.com/acme/widget/HEAD/docs/demo.gif': {
          type: 'image/gif',
          bytes: 9_000,
        },
      }),
      log,
    )
    expect(tiny).toBeNull()
  })

  it('returns null, never throws, when the readme or probe fails', async () => {
    expect(
      await captureRepoDemo(
        'a',
        'b',
        {
          readme: async () => {
            throw new Error('boom')
          },
          probe: async () => null,
        },
        log,
      ),
    ).toBeNull()
    expect(
      await captureRepoDemo('a', 'b', { readme: async () => null, probe: async () => null }, log),
    ).toBeNull()
  })

  it('maps content types', () => {
    expect(kindOfType('video/webm', 'x')).toBe('webm')
    expect(kindOfType('application/octet-stream', 'https://x/a.mov')).toBe('mp4')
    expect(kindOfType('image/png', 'https://x/a.png')).toBeNull()
  })
})

describe('vetImages', () => {
  const img = (n: number, kind: ItemImage['kind'] = 'figure'): ItemImage => ({
    url: `https://cdn.example.com/${n}.png`,
    kind,
  })
  const verdict = (over: Partial<VetResult> = {}): VetResult => ({
    keep: true,
    reason: 'ok',
    role: 'figure',
    caption: 'Latency by region',
    text: '',
    focus: { x: 0.3, y: 0.6 },
    ...over,
  })
  const memCache = (): VetCache & { map: Map<string, VetResult> } => {
    const map = new Map<string, VetResult>()
    return { map, get: async (h) => map.get(h) ?? null, set: async (h, r) => void map.set(h, r) }
  }
  const png = async () => ({ mime: 'image/png', base64: 'AAAA' })

  it('drops junk, logos and keep=false; keeps caption, role and focus on the rest', async () => {
    const answers = [verdict(), verdict({ role: 'junk', keep: false }), verdict({ role: 'logo' })]
    const ask = vi.fn(async () => ({ text: JSON.stringify(answers.shift()) }))
    const out = await vetImages([img(1), img(2), img(3)], {
      ask,
      download: png,
      cache: memCache(),
      log,
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      role: 'figure',
      caption: 'Latency by region',
      focus: { x: 0.3, y: 0.6 },
    })
  })

  it('caches per url hash so a second item makes no model call', async () => {
    const cache = memCache()
    const ask = vi.fn(async () => ({ text: JSON.stringify(verdict()) }))
    await vetImages([img(1)], { ask, download: png, cache, log })
    await vetImages([img(1)], { ask, download: png, cache, log })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(cache.map.has(await urlHash(img(1).url))).toBe(true)
  })

  it('skips cleanly on a 402 quota error: images stay as captured, no further calls', async () => {
    const ask = vi.fn(async () => {
      throw new QuotaExhaustedError(402, 'Claude HTTP 402: credits depleted')
    })
    const input = [img(1), img(2), img(3)]
    const out = await vetImages(input, { ask, download: png, cache: memCache(), log })
    expect(out).toEqual(input)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('keeps an image when the answer is not valid JSON or the download fails', async () => {
    const bad = await vetImages([img(1)], {
      ask: async () => ({ text: 'not json' }),
      download: png,
      cache: memCache(),
      log,
    })
    expect(bad).toEqual([img(1)])
    const ask = vi.fn()
    const noFile = await vetImages([img(2)], {
      ask,
      download: async () => null,
      cache: memCache(),
      log,
    })
    expect(noFile).toEqual([img(2)])
    expect(ask).not.toHaveBeenCalled()
  })

  it('stops at the per-item cost cap and never vets avatars', async () => {
    const ask = vi.fn(async () => ({ text: JSON.stringify(verdict()) }))
    const input = [img(1), img(2), img(3), img(4, 'avatar')]
    const out = await vetImages(input, {
      ask,
      download: png,
      cache: memCache(),
      log,
      costCapUsd: 0.0005,
    })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(4)
  })

  it('normalizes caption length and clamps focus', () => {
    const v = normalizeVet({
      keep: true,
      role: 'hero',
      caption: 'x'.repeat(100),
      focus: { x: 4, y: -1 },
    })!
    expect(v.caption.length).toBeLessThanOrEqual(60)
    expect(v.focus).toEqual({ x: 1, y: 0 })
    expect(normalizeVet({ keep: 'yes' })).toBeNull()
    expect(applyVerdict(img(1), verdict({ role: 'hero' }))?.role).toBe('hero')
  })

  it("keepAll annotates a post's own images without dropping them, and carries the text", async () => {
    const answers = [
      verdict({ text: 'GPT-6 scores 41% on RLI' }),
      verdict({
        role: 'junk',
        keep: false,
        caption: 'meme about agents',
        text: 'me: one more prompt',
      }),
    ]
    const ask = vi.fn(async () => ({ text: JSON.stringify(answers.shift()) }))
    const out = await vetImages(
      [img(1), img(2)],
      { ask, download: png, cache: memCache(), log },
      { keepAll: true },
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ role: 'figure', text: 'GPT-6 scores 41% on RLI' })
    expect(out[1]).toMatchObject({ caption: 'meme about agents', text: 'me: one more prompt' })
    expect(out[1]).not.toHaveProperty('role')
  })
})

describe('createClaudeVetter', () => {
  it('sends the image before the vet prompt at low effort and returns the text', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [{ type: 'text', text: '{"keep":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1500, output_tokens: 80 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const ask = createClaudeVetter('k', 'claude-haiku-5-5', log, { fetch: fetchImpl })
    const res = await ask({ mime: 'image/png', base64: 'AAAA' })
    expect(res.text).toBe('{"keep":true}')
    const content = (bodies[0]!.messages as { content: { type: string }[] }[])[0]!.content
    expect(content.map((b) => b.type)).toEqual(['image', 'text'])
    expect(bodies[0]!.output_config).toEqual({ effort: 'low' })
    expect(bodies[0]).not.toHaveProperty('temperature')
  })

  it('rejects image types Claude cannot read without calling the API', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const ask = createClaudeVetter('k', 'm', log, { fetch: fetchImpl })
    await expect(ask({ mime: 'image/svg+xml', base64: 'AAAA' })).rejects.toThrow(/not supported/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
