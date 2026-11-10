import { errorFields, type Logger } from '@reelset/core'
import { RECENT_REELS_WINDOW, isRejectedScene, matchesIntent, queryFor } from './broll-relevance'

export const PEXELS_SEARCH_URL = 'https://api.pexels.com/videos/search'
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60_000
export const HOURLY_REQUEST_BUDGET = 180
/** Candidates sent per reel: every cutaway slot needs a clip of its own, and the container drops dark or blurry ones (about 40%), keeping up to 14. */
export const MAX_REEL_CLIPS = 20
export const PER_PAGE = 30
const MIN_WIDTH = 1080
const MIN_HEIGHT = 1920
const MIN_SECONDS = 4
const MAX_SECONDS = 45
// The container refuses stock clips over 25 MB (reel/media.py MAX_CLIP_BYTES).
export const MAX_FILE_BYTES = 25 * 1024 * 1024
const USAGE_KEY = 'cache/pexels/usage.json'
const RATE_KEY = 'cache/pexels/rate.json'
const RECENT_KEY = 'cache/pexels/recent.json'

export type BrollPick = {
  url: string
  id: number
  beat: number
  seconds: number
  creator: string
  creatorUrl: string
  pageUrl: string
}

type Cached = {
  id: number
  link: string
  width: number
  height: number
  seconds: number
  creator: string
  creatorUrl: string
  pageUrl: string
}

export type Cache = Pick<R2Bucket, 'get' | 'put'>
export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>

const ABSTRACT: [RegExp, string[]][] = [
  // Topic before tooling: an email story gets mail footage, not another keyboard.
  [
    /\b(e-?mails?|inbox\w*|mailbox\w*|mail|spam|bounc\w*|smtp|dmarc|dkim|newsletter)\b/i,
    ['email inbox', 'envelope letters'],
  ],
  [
    /\b(phishing|spoof\w*|impersonat\w*|fraud|scam\w*|password\w*|authenticat\w*)\b/i,
    ['cyber security', 'padlock'],
  ],
  [
    /\b(images?|photos?|pictures?|pixels?|diffusion|lora\w*|render\w*)\b/i,
    ['digital art', 'camera lens'],
  ],
  // Not a bare "domain": in a paper it means a data domain, not DNS.
  [
    /\b(dns|nameservers?|registrars?|domain names?|(dmarc|dns|txt|mx) records?)\b/i,
    ['network cables', 'server room'],
  ],
  [
    /\b(terminal|command|cli|shell|install|npm|pip|script)\b/i,
    ['keyboard typing', 'code on screen'],
  ],
  [
    /\b(server|cloud|deploy|infrastructure|latency|scal\w*|cluster)\b/i,
    ['server room', 'data center'],
  ],
  [
    /\b(chip|gpu|hardware|silicon|inference|cuda|accelerat\w*)\b/i,
    ['circuit board', 'computer chip'],
  ],
  [/\b(network|api|request|protocol|http|traffic|bandwidth)\b/i, ['network cables', 'fiber optic']],
  [/\b(database|query|sql|storage|index|cache)\b/i, ['data center', 'server room']],
  [/\b(security|vulnerabilit\w*|attack|exploit|encrypt\w*)\b/i, ['cyber security', 'padlock']],
  [
    /\b(model|neural|training|learning|paper|benchmark|dataset)\b/i,
    ['abstract data visualization', 'digital particles'],
  ],
  [
    /\b(code|compile\w*|function|bug|library|framework|repo|open source)\b/i,
    ['code on screen', 'keyboard typing'],
  ],
]
const SOURCE_DEFAULT: Record<string, string[]> = {
  github: ['code on screen', 'keyboard typing', 'terminal screen', 'circuit board'],
  hn: ['network cables', 'server room', 'code on screen', 'data center'],
  reddit: ['code on screen', 'network cables', 'server room', 'keyboard typing'],
  youtube: ['code on screen', 'server room', 'circuit board', 'data center'],
  papers: ['abstract data visualization', 'circuit board', 'digital particles', 'data center'],
  news: ['data center', 'network cables', 'circuit board', 'server room'],
}
const FALLBACK = ['code on screen', 'keyboard typing', 'server room', 'circuit board']
/** Fillers for a reel whose beats gave fewer terms than it has cutaway slots. */
const EXTRA_TERMS = ['data center', 'circuit board', 'network cables', 'abstract technology']

/** An abstract lowercase search phrase, or null when it looks like a product, person or brand. */
export function cleanTerm(raw: unknown, title: string): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text !== text.toLowerCase()) return null
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0 || words.length > 3 || words.join('').length < 3) return null
  const banned = new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  )
  if (words.some((w) => banned.has(w))) return null
  return words.join(' ')
}

/**
 * Abstract search terms for a beat, best first: the script's own `broll` (1-2), else every matching
 * keyword-map entry (topic before tooling, at most 4), else the source default.
 */
export function termsForBeat(
  beat: { text: string; broll?: readonly string[] },
  source: string | null,
  title: string,
): string[] {
  const given = (beat.broll ?? [])
    .map((t) => cleanTerm(t, title))
    .filter((t): t is string => t !== null)
  if (given.length > 0) return [...new Set(given)].slice(0, 2)
  const matched = ABSTRACT.filter(([re]) => re.test(beat.text)).flatMap(([, terms]) => terms)
  if (matched.length > 0) return [...new Set(matched)].slice(0, 6)
  return SOURCE_DEFAULT[source ?? ''] ?? FALLBACK
}

type PexelsFile = {
  link?: string
  width?: number
  height?: number
  file_type?: string
  size?: number
}
type PexelsVideo = {
  id?: number
  url?: string
  duration?: number
  user?: { name?: string; url?: string }
  video_files?: PexelsFile[]
}

/** Smallest mp4 that is still portrait, at least 1080x1920 and small enough for the container. */
export function pickFile(files: readonly PexelsFile[]): PexelsFile | null {
  const ok = files.filter(
    (f) =>
      typeof f.link === 'string' &&
      f.link.startsWith('https://') &&
      f.file_type === 'video/mp4' &&
      (f.width ?? 0) >= MIN_WIDTH &&
      (f.height ?? 0) >= MIN_HEIGHT &&
      (f.height ?? 0) > (f.width ?? 0) &&
      (f.size ?? 0) <= MAX_FILE_BYTES,
  )
  ok.sort((a, b) => a.width! * a.height! - b.width! * b.height!)
  return ok[0] ?? null
}

const PEOPLE = new Set(
  'woman women man men girl boy person people hand hands finger fingers businessman businesswoman businesspeople couple team colleagues coworkers employee employees student students child children kid kids teen teenager worker workers user customer programmer developer engineer professional face smiling holding using'.split(
    ' ',
  ),
)
const PEOPLE_PENALTY = 4

/** Words that mean a search term was matched in the wrong world ("server" -> restaurant, "cables" -> cable cars). */
const OFF_TOPIC = new Set(
  'restaurant meal meals food waiter dinner coffee kitchen cars car urban city buildings building street bridge stone beach forest mountain landscape sunset ocean animal flower flowers wedding party baby calligraphy lunar year holiday christmas fashion market exchange stock stocks financial tablet'.split(
    ' ',
  ),
)
const OFF_TOPIC_PENALTY = 3

/**
 * Footage that is never a backdrop: it carries printed or readable text or props that read as
 * something else (a vintage CRT, a dbx audio rack, playing cards, a newspaper), distracting under a caption.
 */
const UNUSABLE = new Set(
  'crt vintage retro television tv radio vinyl turntable poker cards casino newspaper newspapers magazine book books audio mixer mixing amplifier speakers rack typewriter sign signage billboard calendar'.split(
    ' ',
  ),
)

export const isUsableSlug = (pageUrl: string): boolean =>
  !slugWords(pageUrl).some((w) => UNUSABLE.has(w))

/** Words of a Pexels page slug ("woman-typing-on-a-laptop-1234567"). */
export function slugWords(pageUrl: string): string[] {
  const slug = /\/video\/([^/]+)/.exec(pageUrl)?.[1] ?? ''
  return slug
    .toLowerCase()
    .replace(/-\d+$/, '')
    .split('-')
    .filter((w) => w.length > 1)
}

/**
 * How well a clip suits a term, lower is better: people-centric stock clichés ("woman typing on
 * laptop") rank behind footage of the thing itself, a slug that names the term ranks first, and
 * Pexels' own relevance order breaks ties.
 */
export function clipScore(clip: Pick<Cached, 'pageUrl' | 'seconds'>, term: string, rank: number) {
  const words = slugWords(clip.pageUrl)
  const people = new Set(words.filter((w) => PEOPLE.has(w))).size
  const named = term.split(' ').filter((w) => words.some((x) => x.startsWith(w.slice(0, 5)))).length
  const off = new Set(words.filter((w) => OFF_TOPIC.has(w))).size
  const length = clip.seconds >= 6 && clip.seconds <= 25 ? 0 : 0.8
  return (
    Math.min(2, people) * PEOPLE_PENALTY +
    Math.min(2, off) * OFF_TOPIC_PENALTY -
    (off > 0 ? 0 : named * 2) +
    length +
    rank * 0.12
  )
}

export function slimVideos(videos: readonly PexelsVideo[]): Cached[] {
  const out: Cached[] = []
  for (const v of videos) {
    const file = pickFile(v.video_files ?? [])
    if (!file || typeof v.id !== 'number' || !v.url || !v.user?.name) continue
    out.push({
      id: v.id,
      link: file.link!,
      width: file.width!,
      height: file.height!,
      seconds: v.duration ?? 0,
      creator: v.user.name,
      creatorUrl: v.user.url ?? 'https://www.pexels.com',
      pageUrl: v.url,
    })
  }
  return out
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readJson<T>(cache: Cache, key: string): Promise<T | null> {
  try {
    const obj = await cache.get(key)
    return obj ? ((await obj.json()) as T) : null
  } catch {
    return null
  }
}

async function writeJson(cache: Cache, key: string, value: unknown): Promise<void> {
  try {
    await cache.put(key, JSON.stringify(value), {
      httpMetadata: { contentType: 'application/json' },
    })
  } catch {
    // the cache is an optimization
  }
}

export type PexelsDeps = {
  apiKey: string
  fetch: Fetch
  cache: Cache
  log: Logger
  now?: () => number
}

/** Cached (7 days) portrait search; stays inside the hourly request budget by serving cache only when it is spent. */
export async function searchVideos(deps: PexelsDeps, term: string): Promise<Cached[]> {
  const now = deps.now?.() ?? Date.now()
  const key = `cache/pexels/search-${PER_PAGE}-${await sha1(term)}.json`
  const hit = await readJson<{ at: number; videos: Cached[] }>(deps.cache, key)
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) return hit.videos

  const rate = await readJson<{ start: number; count: number }>(deps.cache, RATE_KEY)
  const hourStart = rate && now - rate.start < 3_600_000 ? rate.start : now
  const count = rate && hourStart === rate.start ? rate.count : 0
  if (count >= HOURLY_REQUEST_BUDGET) {
    deps.log.warn({ term }, 'pexels hourly budget spent, using stale cache only')
    return hit?.videos ?? []
  }
  await writeJson(deps.cache, RATE_KEY, { start: hourStart, count: count + 1 })

  const url = `${PEXELS_SEARCH_URL}?${new URLSearchParams({ query: term, orientation: 'portrait', size: 'medium', per_page: String(PER_PAGE) })}`
  try {
    const res = await deps.fetch(url, { headers: { authorization: deps.apiKey } })
    if (!res.ok) {
      deps.log.warn({ term, status: res.status }, 'pexels search failed')
      return hit?.videos ?? []
    }
    const body = (await res.json()) as { videos?: PexelsVideo[] }
    const videos = slimVideos(body.videos ?? [])
    await writeJson(deps.cache, key, { at: now, videos })
    deps.log.info({ term, found: videos.length }, 'pexels search')
    return videos
  } catch (err) {
    deps.log.warn({ term, ...errorFields(err) }, 'pexels search errored')
    return hit?.videos ?? []
  }
}

function isOnTopic(pageUrl: string, term: string): boolean {
  const words = slugWords(pageUrl)
  return !isRejectedScene(words) && matchesIntent(words, term)
}

/** The last RECENT_REELS_WINDOW reels' clip ids, newest last; a repeat of the newest entry is not stored twice. */
export function rememberReel(recent: readonly number[][], picks: readonly BrollPick[]): number[][] {
  const ids = picks.map((p) => p.id).sort((a, b) => a - b)
  const last = recent.at(-1)
  if (
    last &&
    last.length === ids.length &&
    [...last].sort((a, b) => a - b).every((v, i) => v === ids[i])
  ) {
    return [...recent]
  }
  return [...recent, picks.map((p) => p.id)].slice(-RECENT_REELS_WINDOW)
}

/**
 * Up to `MAX_REEL_CLIPS` distinct clips per reel, topic first: round one gives each beat a clip for
 * its best term, later rounds add more per beat from its other terms (then generic tech terms) until
 * every cutaway slot of a reel has a clip of its own. Never the same clip twice in a reel, nor two clips of one creator; people-centric
 * or off-topic scenes are rejected; clips used by the last RECENT_REELS_WINDOW reels are skipped unless nothing else fits, then the
 * least-used first (usage counts live in the cache bucket). Returns [] when nothing is found.
 */
export async function pickBroll(
  deps: PexelsDeps,
  beats: readonly { text: string; broll?: readonly string[] }[],
  ctx: { source: string | null; title: string },
): Promise<BrollPick[]> {
  const usage = (await readJson<Record<string, number>>(deps.cache, USAGE_KEY)) ?? {}
  const recentReels = (await readJson<number[][]>(deps.cache, RECENT_KEY)) ?? []
  const recent = new Set(recentReels.flat())
  const taken = new Set<number>()
  // One clip per creator: a stock set shot on one desk is the same footage twice to a viewer.
  const creators = new Set<string>()
  const usedTerms = new Map<string, number>()
  const picks: BrollPick[] = []
  const beatTerms = beats.map((beat) => termsForBeat(beat, ctx.source, ctx.title))
  const take = async (term: string, index: number, allowRecent: boolean): Promise<boolean> => {
    const found = (await searchVideos(deps, queryFor(term)))
      .filter(
        (v) =>
          !taken.has(v.id) &&
          !creators.has(v.creator) &&
          (allowRecent || !recent.has(v.id)) &&
          isUsableSlug(v.pageUrl) &&
          isOnTopic(v.pageUrl, term) &&
          v.seconds >= MIN_SECONDS &&
          v.seconds <= MAX_SECONDS,
      )
      .map((v, rank) => ({ v, score: (usage[v.id] ?? 0) * 1.5 + clipScore(v, term, rank) }))
      .sort((a, b) => a.score - b.score)[0]?.v
    if (!found) return false
    taken.add(found.id)
    creators.add(found.creator)
    usedTerms.set(term, (usedTerms.get(term) ?? 0) + 1)
    usage[found.id] = (usage[found.id] ?? 0) + 1
    picks.push({
      url: found.link,
      id: found.id,
      beat: index + 1,
      seconds: Math.min(found.seconds, 6),
      creator: found.creator,
      creatorUrl: found.creatorUrl,
      pageUrl: found.pageUrl,
    })
    return true
  }
  for (let round = 0; round < 10 && picks.length < MAX_REEL_CLIPS; round += 1) {
    let added = false
    for (const [index, terms] of beatTerms.entries()) {
      if (picks.length >= MAX_REEL_CLIPS) break
      const pool = round < 3 ? terms : [...terms, ...EXTRA_TERMS]
      // A term already used goes last, so the reel is not four keyboards.
      const ordered = [...pool].sort((a, b) => (usedTerms.get(a) ?? 0) - (usedTerms.get(b) ?? 0))
      for (const allowRecent of [false, true]) {
        for (const term of ordered) {
          if (await take(term, index, allowRecent)) {
            added = true
            break
          }
        }
        if (added) break
      }
    }
    if (!added) break
  }
  if (picks.length > 0) {
    await writeJson(deps.cache, USAGE_KEY, usage)
    await writeJson(deps.cache, RECENT_KEY, rememberReel(recentReels, picks))
  }
  deps.log.info({ picks: picks.length, beats: beats.length }, 'b-roll picked')
  return picks
}
