import { describe, expect, it } from 'vitest'
import {
  JUDGE_ERROR_MESSAGES,
  judgeErrorMessage,
  parseItemReference,
  parseJudgeResponse,
  sourceUrlCandidates,
  type JudgeErrorCode,
} from './gate-judge'

const ID = '1a2b3c4d-2222-4333-8444-555555555555'
const candidates = (text: string) => {
  const ref = parseItemReference(text)
  return ref?.kind === 'url' ? ref.candidates : []
}

describe('parseItemReference', () => {
  it('reads a raw item id in any case', () => {
    expect(parseItemReference(`  ${ID.toUpperCase()} `)).toEqual({ kind: 'id', id: ID })
  })

  it('reads reel links by their short id, with or without a slug, scheme or query', () => {
    const short = { kind: 'shortId', shortId: '1a2b3c4d' }
    expect(parseItemReference('https://reelset.app/r/fast-rust-compiler-1a2b3c4d')).toEqual(short)
    expect(parseItemReference('reelset.app/r/1a2b3c4d')).toEqual(short)
    expect(
      parseItemReference('https://www.reelset.app/r/x-1a2b3c4d/?topic=ai&utm_source=x'),
    ).toEqual(short)
    expect(parseItemReference('http://localhost:3000/r/x-1a2b3c4d')).toEqual(short)
    expect(parseItemReference('fast-rust-compiler-1a2b3c4d')).toEqual(short)
    expect(parseItemReference('1a2b3c4d')).toEqual(short)
  })

  it('reads old reel links that carry the full id', () => {
    expect(parseItemReference(`https://reelset.app/r/${ID}`)).toEqual({ kind: 'id', id: ID })
    expect(parseItemReference(`https://reelset.app/?reel=${ID}`)).toEqual({ kind: 'id', id: ID })
  })

  it('treats any other link as a source URL, even one that looks like a reel path elsewhere', () => {
    expect(parseItemReference('https://example.com/r/thing-1a2b3c4d')).toMatchObject({
      kind: 'url',
    })
    expect(parseItemReference('github.com/acme/repo')).toMatchObject({ kind: 'url' })
  })

  it('rejects text that is none of these', () => {
    for (const bad of ['', '   ', 'hello world', 'ftp://example.com/x', 'javascript:alert(1)']) {
      expect(parseItemReference(bad), bad).toBeNull()
    }
  })
})

describe('sourceUrlCandidates', () => {
  it('covers http and https, www and bare host, and the trailing slash', () => {
    expect(candidates('http://WWW.GitHub.com/acme/repo/').sort()).toEqual(
      [
        'http://github.com/acme/repo',
        'http://github.com/acme/repo/',
        'http://www.github.com/acme/repo',
        'http://www.github.com/acme/repo/',
        'https://github.com/acme/repo',
        'https://github.com/acme/repo/',
        'https://www.github.com/acme/repo',
        'https://www.github.com/acme/repo/',
      ].sort(),
    )
  })

  it('keeps the case of the path', () => {
    expect(candidates('https://github.com/Acme/Repo')).toContain('https://github.com/Acme/Repo')
  })

  it('drops trackers and the fragment but keeps the parameters that identify the page', () => {
    const hn = candidates('https://news.ycombinator.com/item?id=123&utm_source=x&ref=y#comments')
    expect(hn).toContain('https://news.ycombinator.com/item?id=123')
    expect(
      hn.some((url) => url.includes('utm_') || url.includes('ref=') || url.includes('#')),
    ).toBe(false)
    expect(candidates('https://example.com/post?fbclid=abc&gclid=def')).toContain(
      'https://example.com/post',
    )
  })

  it('maps short YouTube links onto the watch URL', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    expect(candidates('https://youtu.be/dQw4w9WgXcQ?si=abc')).toContain(watch)
    expect(candidates('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toContain(watch)
    expect(candidates('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')).toContain(watch)
    expect(candidates('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toContain(
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    )
  })

  it('never yields more than eight spellings', () => {
    expect(sourceUrlCandidates(new URL('https://example.com/a/b/')).length).toBeLessThanOrEqual(8)
  })
})

describe('parseJudgeResponse', () => {
  const decision = { id: 'd1', verdict: 'reel', score: 62.5, threshold: 55, signals: {} }

  it('accepts a 200 with a decision', () => {
    expect(parseJudgeResponse(200, { ok: true, decision })).toEqual({
      ok: true,
      decision: { id: 'd1', verdict: 'reel', score: 62.5, threshold: 55 },
    })
  })

  it('passes every documented error code through', () => {
    const codes: [number, JudgeErrorCode][] = [
      [400, 'invalid_request'],
      [404, 'item_not_found'],
      [422, 'no_evidence'],
      [422, 'over_budget'],
      [502, 'judge_failed'],
      [503, 'quota_exhausted'],
      [504, 'judge_timeout'],
      [500, 'internal_error'],
    ]
    for (const [status, code] of codes) {
      const body = { ok: false, error: { code, message: 'x' } }
      expect(parseJudgeResponse(status, body)).toEqual({ ok: false, code })
    }
  })

  it('falls back on the status for a body it does not recognise', () => {
    expect(parseJudgeResponse(504, null)).toEqual({ ok: false, code: 'judge_timeout' })
    expect(parseJudgeResponse(404, '<html>')).toEqual({ ok: false, code: 'item_not_found' })
    expect(parseJudgeResponse(500, { ok: false, error: { code: 'brand_new' } })).toEqual({
      ok: false,
      code: 'internal_error',
    })
    expect(parseJudgeResponse(200, { ok: true })).toEqual({ ok: false, code: 'internal_error' })
    expect(parseJudgeResponse(200, { ok: true, decision: { ...decision, verdict: 'x' } })).toEqual({
      ok: false,
      code: 'internal_error',
    })
  })
})

describe('judgeErrorMessage', () => {
  it('has a distinct plain sentence for every code, with no code names in it', () => {
    const messages = Object.values(JUDGE_ERROR_MESSAGES)
    expect(new Set(messages).size).toBe(messages.length)
    for (const code of Object.keys(JUDGE_ERROR_MESSAGES) as JudgeErrorCode[]) {
      expect(judgeErrorMessage(code)).toMatch(/^[A-Z].*\.\)?$/)
      expect(judgeErrorMessage(code)).not.toContain(code)
    }
  })

  it('tells the admin what to do when there is no source text or the cap is too low', () => {
    expect(judgeErrorMessage('no_evidence')).toContain('no stored source text')
    expect(judgeErrorMessage('over_budget')).toContain('Gate settings')
  })
})
