import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Logger } from '@reelset/core'
import { silentLog } from '../testing'
import {
  IG_GRAPH_VERSION,
  OfficialApiError,
  classifyMetaError,
  createOfficialClient,
  type MetaApp,
} from './official-client'

const TOKEN = 'IGAAtesttokenvalue1234567890'
const IG_ID = '17841400000000001'
const APP = { id: '4242', secret: 'app-secret-value-123' }

type Seen = { url: URL; method: string; headers: Record<string, string>; body: unknown }

function fakeApi(
  answer: (seen: Seen) => { status?: number; json: unknown } | Error,
  log = silentLog,
  app: MetaApp | null = null,
) {
  const requests: Seen[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const seen: Seen = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    }
    requests.push(seen)
    const result = answer(seen)
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result.json), { status: result.status ?? 200 })
  }) as typeof fetch
  return { client: createOfficialClient(fetchImpl, log, app), requests }
}

const metaError = (code: number, extra: Record<string, unknown> = {}) => ({
  status: 400,
  json: { error: { message: 'meta says no', type: 'OAuthException', code, ...extra } },
})

async function failure(run: Promise<unknown>): Promise<OfficialApiError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(OfficialApiError)
  return err as OfficialApiError
}

describe('official instagram client requests', () => {
  it('lists the assigned accounts with the token in the Authorization header, never in the URL', async () => {
    const t = fakeApi(() => ({
      json: { data: [{ id: IG_ID, username: 'reelset_app' }], paging: { cursors: {} } },
    }))
    expect(await t.client.listAccounts(TOKEN)).toEqual([{ userId: IG_ID, username: 'reelset_app' }])
    const [req] = t.requests
    expect(req?.url.origin).toBe('https://graph.facebook.com')
    expect(req?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/me/assigned_instagram_accounts`)
    expect(req?.url.searchParams.get('fields')).toBe('id,username')
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(req?.url.toString()).not.toContain(TOKEN)
  })

  it('reads the client business id from /me, or null when there is none', async () => {
    const t = fakeApi(() => ({ json: { client_business_id: '999', id: '1' } }))
    expect(await t.client.getClientBusinessId(TOKEN)).toBe('999')
    expect(t.requests[0]?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/me`)
    expect(t.requests[0]?.url.searchParams.get('fields')).toBe('client_business_id')
    const none = fakeApi(() => ({ json: { id: '1' } }))
    expect(await none.client.getClientBusinessId(TOKEN)).toBeNull()
  })

  it('creates a reel container with the video, cover and caption', async () => {
    const t = fakeApi(() => ({ json: { id: 'c1' } }))
    const id = await t.client.createReelContainer(TOKEN, IG_ID, {
      videoUrl: 'https://media.reelset.app/reels/i1/k.mp4',
      coverUrl: 'https://media.reelset.app/reels/i1/k.jpg',
      caption: 'cap #dev',
      aiGenerated: false,
    })
    expect(id).toBe('c1')
    const [req] = t.requests
    expect(req?.method).toBe('POST')
    expect(req?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/${IG_ID}/media`)
    expect(req?.headers['content-type']).toBe('application/json')
    expect(req?.body).toEqual({
      media_type: 'REELS',
      video_url: 'https://media.reelset.app/reels/i1/k.mp4',
      cover_url: 'https://media.reelset.app/reels/i1/k.jpg',
      caption: 'cap #dev',
      share_to_feed: true,
    })
  })

  it('leaves the cover out when there is none and adds the AI label only when asked', async () => {
    const t = fakeApi(() => ({ json: { id: 'c1' } }))
    await t.client.createReelContainer(TOKEN, IG_ID, {
      videoUrl: 'https://media.reelset.app/v.mp4',
      coverUrl: null,
      caption: 'cap',
      aiGenerated: true,
    })
    expect(t.requests[0]?.body).toEqual({
      media_type: 'REELS',
      video_url: 'https://media.reelset.app/v.mp4',
      caption: 'cap',
      share_to_feed: true,
      is_ai_generated: true,
    })
  })

  it('reads a container status', async () => {
    const t = fakeApi(() => ({ json: { status_code: 'IN_PROGRESS', id: 'c1' } }))
    expect(await t.client.getContainerStatus(TOKEN, 'c1')).toEqual({
      statusCode: 'IN_PROGRESS',
      status: null,
    })
    expect(t.requests[0]?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/c1`)
    expect(t.requests[0]?.url.searchParams.get('fields')).toBe('status_code,status')
  })

  it('publishes a container by its creation id', async () => {
    const t = fakeApi(() => ({ json: { id: 'm1' } }))
    expect(await t.client.publish(TOKEN, IG_ID, 'c1')).toBe('m1')
    expect(t.requests[0]?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/${IG_ID}/media_publish`)
    expect(t.requests[0]?.body).toEqual({ creation_id: 'c1' })
  })

  it('reads the publishing limit with the quota Instagram reports', async () => {
    const t = fakeApi(() => ({
      json: { data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }] },
    }))
    expect(await t.client.getPublishingLimit(TOKEN, IG_ID)).toEqual({ used: 2, total: 50 })
    expect(t.requests[0]?.url.pathname).toBe(
      `/${IG_GRAPH_VERSION}/${IG_ID}/content_publishing_limit`,
    )
  })

  it('reads a permalink and lists recent media', async () => {
    const t = fakeApi((seen) =>
      seen.url.pathname.endsWith('/media')
        ? {
            json: {
              data: [
                {
                  id: 'm1',
                  caption: 'cap',
                  permalink: 'https://www.instagram.com/reel/A/',
                  timestamp: '2026-11-16T10:00:00+0000',
                },
                { id: 'm2' },
              ],
            },
          }
        : { json: { permalink: 'https://www.instagram.com/reel/A/', id: 'm1' } },
    )
    expect(await t.client.getPermalink(TOKEN, 'm1')).toBe('https://www.instagram.com/reel/A/')
    const media = await t.client.listMediaSince(TOKEN, IG_ID, new Date('2026-11-16T09:00:00Z'))
    expect(media).toEqual([
      {
        id: 'm1',
        caption: 'cap',
        permalink: 'https://www.instagram.com/reel/A/',
        timestamp: new Date('2026-11-16T10:00:00Z'),
      },
      { id: 'm2', caption: null, permalink: null, timestamp: null },
    ])
    expect(t.requests[1]?.url.searchParams.get('since')).toBe('1794819600')
  })

  it('lists a page of media with likes and comments and hands back only the cursor', async () => {
    const t = fakeApi(() => ({
      json: {
        data: [
          {
            id: 'm1',
            shortcode: 'DfzR6tcCO8s',
            permalink: 'https://www.instagram.com/reel/DfzR6tcCO8s/',
            like_count: 12,
            comments_count: 3,
          },
          { id: 'm2' },
        ],
        paging: {
          cursors: { before: 'b', after: 'cursor-2' },
          next: `https://graph.facebook.com/v27.0/1/media?access_token=${TOKEN}&after=cursor-2`,
        },
      },
    }))
    const page = await t.client.listMediaStats(TOKEN, IG_ID, 'cursor-1')
    expect(page).toEqual({
      media: [
        {
          id: 'm1',
          shortcode: 'DfzR6tcCO8s',
          permalink: 'https://www.instagram.com/reel/DfzR6tcCO8s/',
          likes: 12,
          comments: 3,
        },
        { id: 'm2', shortcode: null, permalink: null, likes: null, comments: null },
      ],
      next: 'cursor-2',
    })
    const [req] = t.requests
    expect(req?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/${IG_ID}/media`)
    expect(req?.url.searchParams.get('fields')).toBe(
      'id,shortcode,permalink,like_count,comments_count',
    )
    expect(req?.url.searchParams.get('after')).toBe('cursor-1')
    expect(req?.url.searchParams.get('limit')).toBe('50')
  })

  it('reports the last page of media as having no next cursor', async () => {
    const t = fakeApi(() => ({ json: { data: [], paging: { cursors: { after: 'x' } } } }))
    expect((await t.client.listMediaStats(TOKEN, IG_ID, null)).next).toBeNull()
    expect(t.requests[0]?.url.searchParams.has('after')).toBe(false)
  })

  it('reads reel insights by metric name', async () => {
    const t = fakeApi(() => ({
      json: {
        data: [
          { name: 'views', period: 'lifetime', values: [{ value: 4321 }] },
          { name: 'reach', period: 'lifetime', values: [{ value: 3000 }] },
          { name: 'saved', period: 'lifetime', values: [{ value: 7 }] },
        ],
      },
    }))
    expect(await t.client.getMediaInsights(TOKEN, 'm1')).toEqual({
      views: 4321,
      reach: 3000,
      saves: 7,
      shares: null,
    })
    expect(t.requests[0]?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/m1/insights`)
    expect(t.requests[0]?.url.searchParams.get('metric')).toBe('views,reach,saved,shares')
  })

  it('deletes a media object', async () => {
    const t = fakeApi(() => ({ json: { success: true, deleted_id: 'm1' } }))
    expect(await t.client.deleteMedia(TOKEN, 'm1')).toBe(true)
    expect(t.requests[0]?.method).toBe('DELETE')
    expect(t.requests[0]?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/m1`)
  })
})

describe('official instagram client token management', () => {
  it('cannot inspect or refresh without the Meta app id and secret', async () => {
    const t = fakeApi(() => ({ json: {} }))
    expect(t.client.canManageTokens).toBe(false)
    await failure(t.client.inspectToken(TOKEN))
    await failure(t.client.refreshToken(TOKEN, '999'))
    expect(t.requests).toHaveLength(0)
  })

  it('inspects a token with the app token and reads its expiry and scopes', async () => {
    const t = fakeApi(
      () => ({
        json: {
          data: { is_valid: true, expires_at: 1800000000, scopes: ['instagram_basic'] },
        },
      }),
      silentLog,
      APP,
    )
    expect(t.client.canManageTokens).toBe(true)
    expect(await t.client.inspectToken(TOKEN)).toEqual({
      valid: true,
      expiresAt: new Date(1800000000 * 1000),
      scopes: ['instagram_basic'],
    })
    const [req] = t.requests
    expect(req?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/debug_token`)
    expect(req?.url.searchParams.get('input_token')).toBe(TOKEN)
    expect(req?.headers.authorization).toBe(`Bearer ${APP.id}|${APP.secret}`)
  })

  it('reads expires_at 0 as a token that never expires', async () => {
    const t = fakeApi(() => ({ json: { data: { is_valid: true, expires_at: 0 } } }), silentLog, APP)
    expect(await t.client.inspectToken(TOKEN)).toEqual({ valid: true, expiresAt: null, scopes: [] })
  })

  it('asks the token management api for a new token, signed with the app secret', async () => {
    const t = fakeApi(() => ({ json: { access_token: 'next' } }), silentLog, APP)
    expect(await t.client.refreshToken(TOKEN, '999')).toBe('next')
    const [req] = t.requests
    expect(req?.method).toBe('POST')
    expect(req?.url.pathname).toBe(`/${IG_GRAPH_VERSION}/999/system_user_access_tokens`)
    expect(req?.url.search).toBe('')
    expect(req?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    const expected = createHmac('sha256', APP.secret).update(TOKEN).digest('hex')
    expect(req?.body).toEqual({ appsecret_proof: expected })
  })
})

describe('official instagram client errors', () => {
  it('maps an invalid or expired token', async () => {
    const t = fakeApi(() => metaError(190))
    const err = await failure(t.client.listAccounts(TOKEN))
    expect(err.kind).toBe('token_invalid')
    expect(err.answered).toBe(true)
    expect(err.detail.code).toBe(190)
  })

  it('maps the daily publishing limit and platform throttling to rate_limited', async () => {
    const limit = fakeApi(() => metaError(9, { error_subcode: 2207042 }))
    expect((await failure(limit.client.publish(TOKEN, IG_ID, 'c1'))).kind).toBe('rate_limited')
    const throttled = fakeApi(() => metaError(4))
    expect((await failure(throttled.client.publish(TOKEN, IG_ID, 'c1'))).kind).toBe('rate_limited')
  })

  it('maps a restricted account, a missing permission and a not-ready container', async () => {
    expect(classifyMetaError(400, { code: 25, error_subcode: 2207050 })).toBe('account_restricted')
    expect(classifyMetaError(400, { code: 10 })).toBe('permission')
    expect(classifyMetaError(400, { code: 9007, error_subcode: 2207027 })).toBe('not_ready')
    expect(classifyMetaError(400, { code: 24, error_subcode: 2207008 })).toBe('container_gone')
    expect(classifyMetaError(400, { code: -1, error_subcode: 2207001 })).toBe('transient')
    expect(classifyMetaError(401, null)).toBe('token_invalid')
    expect(classifyMetaError(429, null)).toBe('rate_limited')
    expect(classifyMetaError(502, null)).toBe('transient')
  })

  it('keeps Instagram’s own words for a rejected upload', async () => {
    const t = fakeApi(() =>
      metaError(352, {
        error_subcode: 2207026,
        error_user_msg: 'The video format is not supported.',
      }),
    )
    const err = await failure(
      t.client.createReelContainer(TOKEN, IG_ID, {
        videoUrl: 'https://media.reelset.app/v.mov',
        coverUrl: null,
        caption: 'cap',
        aiGenerated: false,
      }),
    )
    expect(err.kind).toBe('rejected')
    expect(err.message).toBe('The video format is not supported.')
  })

  it('reports a call that never answered as unanswered', async () => {
    const t = fakeApi(() => new TypeError(`fetch failed for token ${TOKEN}`))
    const err = await failure(t.client.publish(TOKEN, IG_ID, 'c1'))
    expect(err.kind).toBe('network')
    expect(err.answered).toBe(false)
    expect(err.message).not.toContain(TOKEN)
  })

  it('rejects an answer that does not have the expected shape', async () => {
    const t = fakeApi(() => ({ json: { nope: true } }))
    expect((await failure(t.client.publish(TOKEN, IG_ID, 'c1'))).kind).toBe('bad_response')
  })

  it('never writes the token to the log', async () => {
    const lines: unknown[] = []
    const record = (...args: unknown[]) => void lines.push(args)
    const log = {
      info: record,
      warn: record,
      error: record,
      debug: record,
      child: () => log,
    } as unknown as Logger
    const ok = fakeApi(() => ({ json: { access_token: 'next' } }), log, APP)
    await ok.client.refreshToken(TOKEN, '999')
    const bad = fakeApi(() => metaError(190), log, APP)
    await failure(bad.client.inspectToken(TOKEN))
    const down = fakeApi(() => new TypeError(`fetch failed ${TOKEN}`), log, APP)
    await failure(down.client.inspectToken(TOKEN))
    expect(lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(lines)).not.toContain(TOKEN)
    expect(JSON.stringify(lines)).not.toContain('next')
    expect(JSON.stringify(lines)).not.toContain(APP.secret)
  })
})
