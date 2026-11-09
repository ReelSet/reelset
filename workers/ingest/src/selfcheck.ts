import type { Logger } from '@reelset/core'
import { YOUTUBE_SEARCH_URL } from './config'

const TRANSCRIPT_URL = 'https://render.internal/transcript'
const MAX_ATTEMPTS = 6

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!
  return diff === 0
}

export function isAuthorized(request: Request, token: string | undefined): boolean {
  if (!token) return false
  const header = request.headers.get('authorization') ?? ''
  return timingSafeEqual(header, `Bearer ${token}`)
}

async function callRender(render: Pick<Fetcher, 'fetch'>, url: string, body: unknown) {
  const startedAt = performance.now()
  const res = await render.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { status: res.status, json, ms: Math.round(performance.now() - startedAt) }
}

async function withRetry<T extends { status: number }>(fn: () => Promise<T>, log: Logger) {
  let last: T | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      last = await fn()
      if (last.status < 500) return last
    } catch (err) {
      log.warn({ attempt, err: String(err) }, 'selfcheck call failed')
    }
    await new Promise((r) => setTimeout(r, attempt * 5000))
  }
  return last
}

export async function runSelfcheck(render: Pick<Fetcher, 'fetch'>, log: Logger) {
  const search = await withRetry(
    () =>
      callRender(render, YOUTUBE_SEARCH_URL, {
        queries: ['claude code tutorial'],
        maxAgeDays: 30,
        perQueryLimit: 3,
      }),
    log,
  )
  const videos = (search?.json?.videos as { videoId: string }[] | undefined) ?? []
  const videoId = videos[0]?.videoId
  const transcript = videoId
    ? await withRetry(() => callRender(render, TRANSCRIPT_URL, { videoId }), log)
    : undefined
  const segments = transcript?.json?.segments as unknown[] | undefined
  return {
    search: {
      httpStatus: search?.status ?? null,
      status: search?.json?.status ?? null,
      videos: videos.length,
      failedQueries: (search?.json?.failedQueries as unknown[] | undefined)?.length ?? null,
      ms: search?.ms ?? null,
    },
    transcript: transcript
      ? {
          httpStatus: transcript.status,
          status: transcript.json?.status ?? null,
          reason: transcript.json?.reason ?? null,
          segments: segments?.length ?? null,
          ms: transcript.ms,
        }
      : null,
  }
}
