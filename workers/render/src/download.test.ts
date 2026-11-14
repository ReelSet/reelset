import { describe, expect, it } from 'vitest'
import { silentLog } from './testing'
import { downloadName, handleDownload } from './download'

const KEY = 'reels/05ec933e-eafc-42d1-a9df-58fe6bcd3897/767cf5bcec2a6f68d38b94f293f41640.mp4'

function bucket(objects: Record<string, string>) {
  return {
    get: async (key: string) =>
      key in objects ? { body: new Response(objects[key]).body, size: objects[key]!.length } : null,
  } as unknown as R2Bucket
}

describe('handleDownload', () => {
  it('serves a reel mp4 as an attachment with a safe filename', async () => {
    const res = await handleDownload(
      new Request(
        `https://render-api.reelset.app/dl/${KEY}?name=${encodeURIComponent('Qwen 4 & "Max"!')}`,
      ),
      bucket({ [KEY]: 'mp4' }),
      silentLog,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Qwen-4-Max.mp4"')
    expect(await res.text()).toBe('mp4')
  })

  it('refuses anything that is not a reel mp4 key', async () => {
    for (const path of ['cache/pexels/x.json', 'reels/../secret.mp4', `${KEY}.jpg`]) {
      const res = await handleDownload(
        new Request(`https://render-api.reelset.app/dl/${path}`),
        bucket({ [path]: 'x' }),
        silentLog,
      )
      expect(res.status).toBe(404)
    }
  })

  it('answers 404 for a malformed percent-encoding', async () => {
    const res = await handleDownload(
      new Request('https://render-api.reelset.app/dl/reels/%E0%A4%A.mp4'),
      bucket({}),
      silentLog,
    )
    expect(res.status).toBe(404)
  })

  it('answers 404 for a missing object', async () => {
    const res = await handleDownload(
      new Request(`https://render-api.reelset.app/dl/${KEY}`),
      bucket({}),
      silentLog,
    )
    expect(res.status).toBe(404)
  })

  it('falls back to a default name', () => {
    expect(downloadName(null)).toBe('reelset-reel.mp4')
    expect(downloadName('!!!')).toBe('reelset-reel.mp4')
  })
})
