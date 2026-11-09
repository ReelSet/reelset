import { describe, expect, it } from 'vitest'
import { createAnswerSplitter, parseCitationIds } from './answer-stream'

function run(deltas: string[]) {
  const emitted: string[] = []
  const splitter = createAnswerSplitter((t) => emitted.push(t))
  for (const d of deltas) splitter.push(d)
  return { ...splitter.finish(), streamed: emitted.join('') }
}

describe('parseCitationIds', () => {
  it('splits, strips decoration, dedupes and drops none', () => {
    expect(parseCitationIds(' [a1], "b-2" a1 ')).toEqual(['a1', 'b-2'])
    expect(parseCitationIds(' none')).toEqual([])
    expect(parseCitationIds('<script>, ok')).toEqual(['ok'])
  })
})

describe('createAnswerSplitter', () => {
  it('streams answer text and parses the trailer', () => {
    const out = run(['Bun is fast.', '\nCITATIONS: a, b'])
    expect(out.streamed).toBe('Bun is fast.')
    expect(out.parsed).toEqual({ answer: 'Bun is fast.', citations: ['a', 'b'] })
  })

  it('never leaks a marker split across deltas', () => {
    const out = run(['Answer', '\nCITA', 'TIONS', ': x'])
    expect(out.streamed).toBe('Answer')
    expect(out.parsed?.citations).toEqual(['x'])
  })

  it('handles a marker-only reply as an empty answer', () => {
    const out = run(['CITATIONS: none'])
    expect(out.streamed).toBe('')
    expect(out.parsed).toEqual({ answer: '', citations: [] })
  })

  it('returns parsed null and flushes the text when the trailer is missing', () => {
    const out = run(['just some words here', ' and more'])
    expect(out.streamed).toBe('just some words here and more')
    expect(out.parsed).toBeNull()
  })

  it('does not treat CITATIONS mid-line as the marker', () => {
    const out = run(['See CITATIONS: in text', '\nCITATIONS: z'])
    expect(out.parsed).toEqual({ answer: 'See CITATIONS: in text', citations: ['z'] })
  })
})
