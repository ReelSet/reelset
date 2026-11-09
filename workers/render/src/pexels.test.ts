import { describe, expect, it, vi } from 'vitest'
import {
  HOURLY_REQUEST_BUDGET,
  cleanTerm,
  pickBroll,
  pickFile,
  searchVideos,
  slimVideos,
  termsForBeat,
  type Cache,
} from './pexels'
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
const video = (id: number, duration = 10, files = [file(1080, 1920)]) => ({
  id,
  url: `https://www.pexels.com/video/${id}/`,
  duration,
  user: { name: `Creator ${id}`, url: `https://www.pexels.com/@c${id}` },
  video_files: files,
})

function fakeFetch(map: Record<string, unknown[]>) {
  return vi.fn(async (url: string) => {
    const q = new URL(url).searchParams.get('query') ?? ''
    return new Response(JSON.stringify({ videos: map[q] ?? [] }), { status: 200 })
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

  it('caps a reel at 5 clips', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `beat ${i}` }))
    const fetch = fakeFetch({
      'code on screen': Array.from({ length: 12 }, (_, i) => video(i + 1)),
      'keyboard typing': [],
    })
    const picks = await pickBroll(
      { apiKey: 'k', fetch, cache: new MemCache(), log: silentLog },
      many,
      ctx,
    )
    expect(picks.length).toBeLessThanOrEqual(5)
  })
})
