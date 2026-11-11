import { describe, expect, it } from 'vitest'
import { silentLog } from '../testing'
import { IgCallError, createIgContainerClient } from './container-client'

const PROXY = { index: 0, country: 'US', switched: false, down: false }
const STATE = { session: { uuids: {} }, proxyIndex: 0 }
const UPLOAD = {
  videoUrl: 'https://media.reelset.app/reels/i1/k.mp4',
  posterUrl: 'https://media.reelset.app/reels/i1/k.jpg',
  caption: 'cap',
}

function fakeContainer(status: number, payload: unknown) {
  const requests: { url: string; body: unknown }[] = []
  const fetcher = {
    async fetch(request: Request) {
      requests.push({ url: request.url, body: await request.json() })
      return new Response(JSON.stringify(payload), { status })
    },
  }
  return { client: createIgContainerClient(fetcher, silentLog), requests }
}

describe('instagram container client post', () => {
  it('sends the video, the poster and the caption with the session', async () => {
    const t = fakeContainer(200, {
      mediaPk: '1',
      permalink: 'https://www.instagram.com/p/A/',
      session: { a: 1 },
      proxy: PROXY,
    })
    const result = await t.client.post(STATE, UPLOAD)
    expect(result.mediaPk).toBe('1')
    expect(t.requests).toEqual([
      { url: expect.stringMatching(/\/instagram\/post$/), body: { ...STATE, ...UPLOAD } },
    ])
  })

  it('sends a null poster when there is none, so the container picks a frame', async () => {
    const t = fakeContainer(200, {
      mediaPk: '1',
      permalink: 'https://www.instagram.com/p/A/',
      session: {},
      proxy: PROXY,
    })
    await t.client.post(STATE, { ...UPLOAD, posterUrl: null })
    expect(t.requests[0]?.body).toMatchObject({ posterUrl: null })
  })

  it('surfaces the container error code as a reached-container failure', async () => {
    const t = fakeContainer(502, { error: 'upload_failed', message: 'boom' })
    const err = await t.client.post(STATE, UPLOAD).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IgCallError)
    expect(err).toMatchObject({ code: 'upload_failed', message: 'boom', reachedContainer: true })
  })
})

describe('instagram container client find', () => {
  it('sends the caption and the start time in epoch seconds', async () => {
    const t = fakeContainer(200, {
      found: true,
      mediaPk: '9',
      permalink: 'https://www.instagram.com/p/F/',
      session: {},
      proxy: PROXY,
    })
    const out = await t.client.find(STATE, 'cap', new Date('2026-11-11T10:26:39.900Z'), ['5'])
    expect(out).toMatchObject({ found: true, mediaPk: '9' })
    expect(t.requests[0]).toEqual({
      url: expect.stringMatching(/\/instagram\/find$/),
      body: { ...STATE, caption: 'cap', since: 1794392799, excludeMediaPks: ['5'] },
    })
  })

  it('accepts a not-found answer without media fields', async () => {
    const t = fakeContainer(200, { found: false, session: {}, proxy: PROXY })
    expect((await t.client.find(STATE, 'cap', new Date(), [])).found).toBe(false)
  })
})
