import { z } from 'zod'
import { parseReelParam } from '@/lib/reel-url'
import { SITE_URL } from '@/lib/seo/site'

export const JUDGE_TIMEOUT_MS = 60_000
export const JUDGE_PATH = '/internal/gate/judge'
export const LINK_INPUT_MAX_CHARS = 2000

export const JUDGE_ERROR_MESSAGES = {
  invalid_request: 'The gate did not accept this request. Reload the page and try again.',
  item_not_found: 'This item no longer exists.',
  no_evidence:
    'This item has no stored source text, so there is nothing for the gate to read. It cannot be judged.',
  over_budget:
    'The max cost per item is too low for the chosen model, so the gate cannot judge. Raise the cap or pick a cheaper model in Gate settings.',
  judge_failed: 'The model call failed. Try again in a moment.',
  quota_exhausted: 'The model account is out of quota right now. Try again later.',
  judge_timeout: 'The gate took too long to answer. Try again.',
  internal_error: 'Something went wrong in the ingest worker. See its logs.',
  not_configured:
    'The web app is not connected to the ingest worker (INGEST_INTERNAL_URL and INGEST_INTERNAL_TOKEN are not set).',
  unreachable: 'Could not reach the ingest worker. Try again in a moment.',
} as const

export type JudgeErrorCode = keyof typeof JUDGE_ERROR_MESSAGES

const FALLBACK_BY_STATUS: Record<number, JudgeErrorCode> = {
  400: 'invalid_request',
  404: 'item_not_found',
  502: 'judge_failed',
  503: 'quota_exhausted',
  504: 'judge_timeout',
}

export function judgeErrorMessage(code: JudgeErrorCode): string {
  return JUDGE_ERROR_MESSAGES[code]
}

const isJudgeErrorCode = (code: unknown): code is JudgeErrorCode =>
  typeof code === 'string' && Object.hasOwn(JUDGE_ERROR_MESSAGES, code)

const successSchema = z.object({
  ok: z.literal(true),
  decision: z.object({
    id: z.string().min(1),
    verdict: z.enum(['reel', 'source_only']),
    score: z.number().nullable(),
    threshold: z.number(),
  }),
})

const failureSchema = z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) })

export type JudgeDecisionSummary = z.infer<typeof successSchema>['decision']
export type JudgeOutcome =
  { ok: true; decision: JudgeDecisionSummary } | { ok: false; code: JudgeErrorCode }

/** Reads the ingest judge route's answer; anything it does not recognise becomes the error that fits the HTTP status. */
export function parseJudgeResponse(status: number, body: unknown): JudgeOutcome {
  const success = successSchema.safeParse(body)
  if (status === 200 && success.success) return { ok: true, decision: success.data.decision }
  const failure = failureSchema.safeParse(body)
  if (failure.success && isJudgeErrorCode(failure.data.error.code)) {
    return { ok: false, code: failure.data.error.code }
  }
  return { ok: false, code: FALLBACK_BY_STATUS[status] ?? 'internal_error' }
}

export type ItemReference =
  | { kind: 'id'; id: string }
  | { kind: 'shortId'; shortId: string }
  | { kind: 'url'; candidates: string[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REEL_PATH_RE = /^\/r\/([^/]+)\/?$/
const TRACKING_PARAM_RE =
  /^(utm_\w+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|ref|ref_src|ref_url|si|feature|share_id)$/i

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '')
const SITE_HOST = bareHost(new URL(SITE_URL).host)

function toUrl(text: string): URL | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isSiteHost(host: string): boolean {
  const bare = bareHost(host)
  return bare === SITE_HOST || bare.endsWith(`.${SITE_HOST}`) || bare.startsWith('localhost')
}

function reelReference(url: URL): ItemReference | null {
  if (!isSiteHost(url.host)) return null
  const raw = REEL_PATH_RE.exec(url.pathname)?.[1] ?? url.searchParams.get('reel')
  const param = raw ? parseReelParam(raw) : null
  if (!param) return null
  return param.id ? { kind: 'id', id: param.id } : { kind: 'shortId', shortId: param.shortId }
}

function withoutTrackers(url: URL): string {
  const kept = [...url.searchParams.entries()].filter(([name]) => !TRACKING_PARAM_RE.test(name))
  const query = new URLSearchParams(kept).toString()
  return query ? `?${query}` : ''
}

// youtu.be/<id> and /shorts/<id> are the same video as watch?v=<id>, which is how sources are stored.
function youtubeWatchUrl(url: URL): URL | null {
  const host = bareHost(url.host)
  const short = host === 'youtu.be' ? url.pathname.slice(1) : null
  const shorts = /^(m\.)?youtube\.com$/.test(host)
    ? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1]
    : null
  const videoId = short || shorts
  return videoId ? new URL(`https://www.youtube.com/watch?v=${videoId}`) : null
}

/** Every spelling a stored source URL may have for this link: http or https, with or without www, with or without a trailing slash; trackers and the fragment are dropped. */
export function sourceUrlCandidates(input: URL): string[] {
  const url = youtubeWatchUrl(input) ?? input
  const host = bareHost(url.host)
  const path = url.pathname.replace(/\/+$/, '')
  const query = withoutTrackers(url)
  const candidates = new Set<string>()
  for (const scheme of ['https', 'http']) {
    for (const prefix of ['', 'www.']) {
      candidates.add(`${scheme}://${prefix}${host}${path}${query}`)
      if (!query) candidates.add(`${scheme}://${prefix}${host}${path}/`)
    }
  }
  return [...candidates]
}

/** Reads what an admin pasted into "Check a link": an item id, a reel link (or its bare `slug-shortid`), or a source URL; null when it is none of these. */
export function parseItemReference(raw: string): ItemReference | null {
  const text = raw.trim().slice(0, LINK_INPUT_MAX_CHARS)
  if (!text) return null
  if (UUID_RE.test(text)) return { kind: 'id', id: text.toLowerCase() }
  const looksLikeUrl = /[./]/.test(text)
  if (!looksLikeUrl) {
    const param = parseReelParam(text)
    return param ? { kind: 'shortId', shortId: param.shortId } : null
  }
  const url = toUrl(text)
  if (!url) return null
  const reel = reelReference(url)
  if (reel || !url.host.includes('.')) return reel
  return { kind: 'url', candidates: sourceUrlCandidates(url) }
}
