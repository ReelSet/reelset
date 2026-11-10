import { describe, expect, it, vi } from 'vitest'
import {
  HOURLY_REQUEST_BUDGET,
  MAX_REEL_CLIPS,
  PER_PAGE,
  clipScore,
  cleanTerm,
  pickBroll,
  pickFile,
  rememberReel,
  searchVideos,
  slimVideos,
  slugWords,
  termsForBeat,
  type Cache,
} from './pexels'
import { RECENT_REELS_WINDOW, queryFor } from './broll-relevance'
import { silentLog } from './testing'

class MemCache implements Cache {
  store = new Map<string, string>()
  async get(key: string) {
    const v = this.store.get(key)
    return v === undefined ? null : ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody)
  }
  async put(key: string, value: unknown) {
    this.store.set(key, String(value))
    return null as unknown as R2Object
  }
}

const file = (w: number, h: number, type = 'video/mp4') => ({
  link: `https://videos.pexels.com/f/${w}x${h}.mp4`,
  width: w,
  height: h,
  file_type: type,
})
const video = (id: number, duration = 10, files = [file(1080, 1920)], slug = 'clip') => ({
  id,
  url: `https://www.pexels.com/video/${slug}-${id}/`,
  duration,
  user: { name: `Creator ${id}`, url: `https://www.pexels.com/@c${id}` },
  video_files: files,
})

function fakeFetch(map: Record<string, unknown[]>) {
  const byQuery = Object.fromEntries(Object.entries(map).map(([term, v]) => [queryFor(term), v]))
  return vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('query') ?? ''
    return new Response(JSON.stringify({ videos: byQuery[q] ?? [] }), { status: 200 })
  })
}

describe('terms', () => {
  it('uses the script terms but drops product names and brands', () => {
    expect(cleanTerm('server room', 'OpenAI ships Codex')).toBe('server room')
    expect(cleanTerm('PyTorch', 'x')).toBeNull()
    expect(cleanTerm('codex editor', 'OpenAI ships Codex')).toBeNull()
    expect(cleanTerm('one two three four', 'x')).toBeNull()
  })

  it('maps beat text to abstract terms when the script has none', () => {
    expect(termsForBeat({ text: 'Run this command in your terminal.' }, 'github', 't')).toEqual([
      'keyboard typing',
      'code on screen',
    ])
    expect(termsForBeat({ text: 'Latency drops on the server.' }, 'hn', 't')[0]).toBe('server room')
    expect(termsForBeat({ text: 'Nothing special.' }, 'papers', 't')[0]).toBe(
      'abstract data visualization',
    )
    expect(
      termsForBeat({ text: 'x', broll: ['circuit board', 'Kubernetes'] }, 'news', 'Other'),
    ).toEqual(['circuit board'])
  })

  it('puts the topic before tooling: an email story gets mail footage first', () => {
    const terms = termsForBeat(
      { text: 'Outlook is rejecting emails from domains without a DMARC record.' },
      'hn',
      'Outlook.com rejects email',
    )
    expect(terms[0]).toBe('email inbox')
    expect(terms).toContain('network cables')
    expect(terms).not.toContain('keyboard typing')
    expect(termsForBeat({ text: 'DMARC prevents spoofing and phishing.' }, 'hn', 't')).toContain(
      'cyber security',
    )
  })

  it('reads a bare "domain" as a data domain, not DNS', () => {
    const beat = { text: 'Distillation consolidates domain experts across all domains.' }
    expect(termsForBeat(beat, 'papers', 't')).not.toContain('network cables')
    expect(termsForBeat({ text: 'Add a DNS TXT record.' }, 'hn', 't')).toContain('network cables')
  })
})

describe('file selection', () => {
  it('needs portrait mp4 of at least 1080x1920 and takes the smallest', () => {
    const f = pickFile([
      file(2160, 3840),
      file(1080, 1920),
      file(720, 1280),
      file(1920, 1080),
      file(1080, 1920, 'video/webm'),
    ])
    expect(f?.width).toBe(1080)
    expect(pickFile([file(720, 1280), file(1920, 1080)])).toBeNull()
  })

  it('skips files the container would refuse for size', () => {
    const big = { ...file(1080, 1920), size: 68_000_000 }
    const ok = { ...file(1440, 2560), size: 20_000_000 }
    expect(pickFile([big, ok])?.width).toBe(1440)
    expect(pickFile([big])).toBeNull()
    expect(slimVideos([video(1, 10, [big])])).toEqual([])
  })

  it('drops videos without a usable file or credit', () => {
    expect(
      slimVideos([
        video(1),
        video(2, 10, [file(720, 1280)]),
        { id: 3, video_files: [file(1080, 1920)] },
      ]),
    ).toHaveLength(1)
  })
})

describe('search cache', () => {
  it('caches a search for 7 days', async () => {
    const cache = new MemCache()
    const fetch = fakeFetch({ terminal: [video(1)] })
    const deps = { apiKey: 'k', fetch, cache, log: silentLog, now: () => 1_000_000 }
    expect(await searchVideos(deps, 'terminal')).toHaveLength(1)
    expect(await searchVideos(deps, 'terminal')).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(
      await searchVideos({ ...deps, now: () => 1_000_000 + 8 * 86_400_000 }, 'terminal'),
    ).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('stops calling the API when the hourly budget is spent', async () => {
    const cache = new MemCache()
    cache.store.set(
      'cache/pexels/rate.json',
      JSON.stringify({ start: 5_000, count: HOURLY_REQUEST_BUDGET }),
    )
    const fetch = fakeFetch({ terminal: [video(1)] })
    const out = await searchVideos(
      { apiKey: 'k', fetch, cache, log: silentLog, now: () => 6_000 },
      'terminal',
    )
    expect(out).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns nothing, not an error, when the API fails', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 429 }))
    expect(
      await searchVideos({ apiKey: 'k', fetch, cache: new MemCache(), log: silentLog }, 'x'),
    ).toEqual([])
  })
})

describe('pickBroll', () => {
  const beats = [
    { text: 'Run the terminal command.' },
    { text: 'It scales on a server.' },
    { text: 'Plain words here.' },
  ]
  const ctx = { source: 'github', title: 'acme/widget' }

  it('never reuses a clip within a reel and credits the creator', async () => {
    const cache = new MemCache()
    const same = [video(1), video(2)]
    const fetch = fakeFetch({
      'keyboard typing': same,
      'server room': same,
      'code on screen': same,
    })
    const picks = await pickBroll({ apiKey: 'k', fetch, cache, log: silentLog }, beats, ctx)
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length)
    expect(picks[0]).toMatchObject({
      beat: 1,
      creator: expect.stringContaining('Creator'),
      pageUrl: expect.stringContaining('pexels.com/video'),
    })
  })

  it('takes one clip per creator and never footage that is a prop shot (CRT, audio rack, cards)', async () => {
    const sameDesk = (id: number) => ({ ...video(id), user: { name: 'Desk Co', url: 'https://x' } })
    const fetch = fakeFetch({
      'keyboard typing': [
        sameDesk(1),
        sameDesk(2),
        video(3, 10, [file(1080, 1920)], 'old-crt-monitor-on-a-desk'),
        video(4, 10, [file(1080, 1920)], 'audio-rack-with-dbx'),
        video(5),
      ],
    })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      [beats[0]!],
      ctx,
    )
    expect(picks.map((p) => p.id).sort()).toEqual([1, 5])
    expect(new Set(picks.map((p) => p.creator)).size).toBe(picks.length)
  })

  it('searches a term an earlier beat used only after the fresh ones', async () => {
    const cache = new MemCache()
    const fetch = fakeFetch({
      'email inbox': [video(1), video(2)],
      'envelope letters': [video(3)],
    })
    const mail = [{ text: 'Mail bounces.' }, { text: 'More mail bounces.' }]
    const picks = await pickBroll({ apiKey: 'k', fetch, cache, log: silentLog }, mail, ctx)
    expect(picks.slice(0, 2).map((p) => p.id)).toEqual([1, 3])
    const queries = fetch.mock.calls.map((c) => new URL(c[0]).searchParams.get('query'))
    expect(queries[1]).toBe(queryFor('envelope letters'))
  })

  it('prefers clips used less in earlier reels', async () => {
    const cache = new MemCache()
    cache.store.set('cache/pexels/usage.json', JSON.stringify({ 1: 5 }))
    const fetch = fakeFetch({ 'keyboard typing': [video(1), video(2)] })
    const picks = await pickBroll({ apiKey: 'k', fetch, cache, log: silentLog }, [beats[0]!], ctx)
    expect(picks[0]!.id).toBe(2)
    expect(JSON.parse(cache.store.get('cache/pexels/usage.json')!)['2']).toBe(1)
  })

  it('skips clips that are too short and returns [] when nothing matches', async () => {
    const fetch = fakeFetch({ 'keyboard typing': [video(1, 2)] })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      [beats[0]!],
      ctx,
    )
    expect(picks).toEqual([])
  })

  it('caps a reel at the candidate limit', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `beat ${i}` }))
    const fetch = fakeFetch({
      'code on screen': Array.from({ length: 30 }, (_, i) => video(i + 1)),
      'keyboard typing': [],
    })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      many,
      ctx,
    )
    expect(picks.length).toBe(MAX_REEL_CLIPS)
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length)
  })

  it('finds a distinct clip for every cutaway slot, several per beat', async () => {
    const fetch = fakeFetch({
      'keyboard typing': Array.from({ length: 12 }, (_, i) => video(100 + i)),
      'code on screen': Array.from({ length: 12 }, (_, i) => video(200 + i)),
      'server room': Array.from({ length: 12 }, (_, i) => video(300 + i)),
    })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      beats,
      ctx,
    )
    expect(picks.length).toBe(MAX_REEL_CLIPS)
    expect(new Set(picks.map((p) => p.id)).size).toBe(MAX_REEL_CLIPS)
    expect(new Set(picks.map((p) => p.beat)).size).toBeGreaterThan(1)
  })

  it('ranks footage of the thing ahead of a person typing on a laptop', async () => {
    const fetch = fakeFetch({
      'keyboard typing': [
        video(1, 10, [file(1080, 1920)], 'woman-typing-on-laptop'),
        video(2, 10, [file(1080, 1920)], 'close-up-of-a-keyboard-typing'),
      ],
    })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      [beats[0]!],
      ctx,
    )
    expect(picks[0]!.id).toBe(2)
  })

  it('asks for a full page of results per term', async () => {
    const fetch = fakeFetch({ terminal: [video(1)] })
    await searchVideos({ apiKey: 'k', fetch, cache: new MemCache(), log: silentLog }, 'terminal')
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get('per_page')).toBe(String(PER_PAGE))
    expect(PER_PAGE).toBeGreaterThanOrEqual(30)
  })
})

describe('clip ranking', () => {
  it('reads the slug of a Pexels page', () => {
    expect(slugWords('https://www.pexels.com/video/woman-typing-on-a-laptop-1234567/')).toEqual([
      'woman',
      'typing',
      'on',
      'laptop',
    ])
  })

  it('puts a term matched in the wrong world last', () => {
    const waiter = {
      pageUrl: 'https://www.pexels.com/video/restaurant-server-delivering-meals-1/',
      seconds: 10,
    }
    const rack = {
      pageUrl: 'https://www.pexels.com/video/rows-of-racks-in-a-data-hall-2/',
      seconds: 10,
    }
    expect(clipScore(rack, 'server room', 6)).toBeLessThan(clipScore(waiter, 'server room', 0))
  })

  it('penalises people, rewards a slug that names the term', () => {
    const person = { pageUrl: 'https://www.pexels.com/video/a-man-using-a-laptop-1/', seconds: 10 }
    const thing = { pageUrl: 'https://www.pexels.com/video/server-room-corridor-2/', seconds: 10 }
    expect(clipScore(thing, 'server room', 3)).toBeLessThan(clipScore(person, 'server room', 0))
  })
})

describe('relevance and diversity', () => {
  const ctx = { source: 'hn', title: 'Some story' }
  const beats = [{ text: 'x', broll: ['network cables'] }]
  const run = async (videos: unknown[], cache = new MemCache(), b = beats, now?: () => number) =>
    pickBroll(
      {
        apiKey: 'k',
        fetch: fakeFetch({ 'network cables': videos, 'server room': [], 'data center': [] }),
        cache,
        log: silentLog,
        now,
      },
      b,
      ctx,
    )

  it('searches a concrete scene instead of the ambiguous phrase', async () => {
    const fetch = fakeFetch({})
    await pickBroll({ apiKey: 'k', fetch, cache: new MemCache(), log: silentLog }, beats, ctx)
    const queries = fetch.mock.calls.map((c) => new URL(c[0]).searchParams.get('query'))
    expect(queries[0]).toBe('ethernet cable')
    expect(queries).not.toContain('network cables')
  })

  it.each([
    ['cable car', 'cable-car-over-the-city'],
    ['tram', 'tram-with-cables-overhead'],
    ['woman with child', 'woman-with-child-near-network-cables'],
    ['soldering', 'soldering-an-electronic-circuit-board'],
    ['stock chart', 'stock-chart-on-computer-screen'],
    ['dark hallway', 'dark-hallway-with-cables'],
    ['cable-stayed bridge', 'driving-on-a-modern-cable-stayed-bridge'],
    ['gym', 'focused-gym-workout-with-cable-machine'],
  ])('rejects %s', async (_name, slug) => {
    expect(await run([video(1, 10, [file(1080, 1920)], slug)])).toEqual([])
  })

  it('rejects a described clip that names neither the term nor a tech scene', async () => {
    expect(await run([video(1, 10, [file(1080, 1920)], 'person-wearing-plaster-mask')])).toEqual([])
    expect(await run([video(2, 10, [file(1080, 1920)], 'ocean-waves-at-sunset')])).toEqual([])
  })

  it('accepts an on-topic described clip', async () => {
    const picks = await run([
      video(1, 10, [file(1080, 1920)], 'ethernet-cables-plugged-into-router'),
    ])
    expect(picks.map((p) => p.id)).toEqual([1])
  })

  it('picks fresh clips ahead of those used by the last reels', async () => {
    const cache = new MemCache()
    const slug = 'ethernet-cables-in-a-router'
    const old = [video(1, 10, [file(1080, 1920)], slug), video(2, 10, [file(1080, 1920)], slug)]
    expect((await run(old, cache)).map((p) => p.id).sort()).toEqual([1, 2])
    const fresh = [...old, video(3, 10, [file(1080, 1920)], slug)]
    const later = () => Date.now() + 8 * 24 * 3_600_000
    const second = await run(fresh, cache, beats, later)
    expect(second[0]!.id).toBe(3)
  })

  it('reuses a recent clip when nothing fresh is left', async () => {
    const cache = new MemCache()
    const pool = [video(1, 10, [file(1080, 1920)], 'ethernet-cables-in-a-router')]
    await run(pool, cache)
    expect((await run(pool, cache)).map((p) => p.id)).toEqual([1])
  })

  it('remembers only the last reels and does not store a repeat of the newest twice', () => {
    const pick = (id: number) => ({ id }) as never
    let recent: number[][] = []
    for (let i = 1; i <= RECENT_REELS_WINDOW + 2; i++) recent = rememberReel(recent, [pick(i)])
    expect(recent).toHaveLength(RECENT_REELS_WINDOW)
    expect(rememberReel(recent, [pick(RECENT_REELS_WINDOW + 2)])).toEqual(recent)
  })
})
