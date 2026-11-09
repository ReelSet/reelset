import { z } from 'zod'
import { errorFields, type Logger } from '@reelset/core'
import { CONTAINER_BASE_URL, TRANSCRIPT_TIMEOUT_MS, YOUTUBE_SEARCH_TIMEOUT_MS } from './constants'
import type { ContainerFetcher } from './container-client'

export type Route = 'transcript' | 'youtube_search' | 'parse_paper' | 'not_found'

export function matchRoute(method: string, pathname: string): Route {
  if (method !== 'POST') return 'not_found'
  if (pathname === '/transcript') return 'transcript'
  if (pathname === '/youtube/search') return 'youtube_search'
  if (pathname === '/parse/paper') return 'parse_paper'
  return 'not_found'
}

const transcriptRequestSchema = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) })

const transcriptResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    language: z.string(),
    segments: z.array(z.object({ text: z.string(), start: z.number(), duration: z.number() })),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['blocked', 'no_captions', 'error']),
  }),
])

const containerDown = () =>
  Response.json({ status: 'error', reason: 'container_unavailable' }, { status: 503 })

export async function handleTranscript(
  request: Request,
  container: ContainerFetcher,
  log: Logger,
): Promise<Response> {
  const body = transcriptRequestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid videoId' }, { status: 400 })
  const clog = log.child({ videoId: body.data.videoId })

  try {
    const res = await container.fetch(
      new Request(`${CONTAINER_BASE_URL}/transcript`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.data),
        signal: AbortSignal.timeout(TRANSCRIPT_TIMEOUT_MS),
      }),
    )
    clog.info({ status: res.status }, 'container transcript call')
    if (!res.ok) return containerDown()
    const parsed = transcriptResponseSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) {
      clog.error('container transcript response did not validate')
      return containerDown()
    }
    clog.info({ result: parsed.data.status }, 'transcript served')
    return Response.json(parsed.data)
  } catch (err) {
    clog.error(errorFields(err), 'container transcript call failed')
    return containerDown()
  }
}

const youtubeSearchRequestSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(100)).min(1).max(30),
  maxAgeDays: z.number().int().min(1).max(30),
  perQueryLimit: z.number().int().min(1).max(20),
})

const youtubeSearchResponseSchema = z.object({
  status: z.literal('ok'),
  videos: z.array(
    z.object({
      videoId: z.string(),
      title: z.string(),
      channelName: z.string(),
      channelId: z.string(),
      url: z.string(),
      publishedAt: z.string(),
      viewCount: z.number().int().nonnegative(),
      durationSec: z.number().int().nullable(),
      description: z.string(),
      thumbnailUrl: z.string(),
    }),
  ),
  failedQueries: z.array(z.string()),
})

export async function handleYoutubeSearch(
  request: Request,
  container: ContainerFetcher,
  log: Logger,
): Promise<Response> {
  const body = youtubeSearchRequestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid search request' }, { status: 400 })
  const clog = log.child({ queries: body.data.queries.length })

  try {
    const res = await container.fetch(
      new Request(`${CONTAINER_BASE_URL}/youtube/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.data),
        signal: AbortSignal.timeout(YOUTUBE_SEARCH_TIMEOUT_MS),
      }),
    )
    clog.info({ status: res.status }, 'container youtube search call')
    if (res.status === 502) {
      const failure: unknown = await res.json().catch(() => null)
      const reason =
        typeof failure === 'object' && failure !== null && 'reason' in failure
          ? String(failure.reason)
          : 'search_failed'
      clog.error({ reason }, 'youtube search failed for every query')
      return Response.json({ status: 'error', reason }, { status: 502 })
    }
    if (!res.ok) return containerDown()
    const parsed = youtubeSearchResponseSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) {
      clog.error('container youtube search response did not validate')
      return containerDown()
    }
    clog.info(
      { videos: parsed.data.videos.length, failedQueries: parsed.data.failedQueries.length },
      'youtube search served',
    )
    return Response.json(parsed.data)
  } catch (err) {
    clog.error(errorFields(err), 'container youtube search call failed')
    return containerDown()
  }
}
