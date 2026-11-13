import { describe, expect, it } from 'vitest'
import { createAnswerSplitter, parseCitationIds, parseFollowups } from './answer-stream'

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
    expect(out.parsed).toEqual({ answer: 'Bun is fast.', citations: ['a', 'b'], followups: [] })
  })

  it('never leaks a marker split across deltas', () => {
    const out = run(['Answer', '\nCITA', 'TIONS', ': x'])
    expect(out.streamed).toBe('Answer')
    expect(out.parsed?.citations).toEqual(['x'])
  })

  it('handles a marker-only reply as an empty answer', () => {
    const out = run(['CITATIONS: none'])
    expect(out.streamed).toBe('')
    expect(out.parsed).toEqual({ answer: '', citations: [], followups: [] })
  })

  it('returns parsed null and flushes the text when the trailer is missing', () => {
    const out = run(['just some words here', ' and more'])
    expect(out.streamed).toBe('just some words here and more')
    expect(out.parsed).toBeNull()
  })

  it('does not treat CITATIONS mid-line as the marker', () => {
    const out = run(['See CITATIONS: in text', '\nCITATIONS: z'])
    expect(out.parsed).toEqual({
      answer: 'See CITATIONS: in text',
      citations: ['z'],
      followups: [],
    })
  })
})

describe('follow-ups', () => {
  it('parses the FOLLOWUPS line and keeps it out of the streamed answer', () => {
    const out = run([
      'Bun is fast [1].',
      '\nFOLLOWUPS: Is Bun stable? | How does Bun compare to Deno? | Who uses Bun in production?',
      '\nCITATIONS: a',
    ])
    expect(out.streamed).toBe('Bun is fast [1].')
    expect(out.parsed).toEqual({
      answer: 'Bun is fast [1].',
      citations: ['a'],
      followups: ['Is Bun stable?', 'How does Bun compare to Deno?', 'Who uses Bun in production?'],
    })
  })

  it('never leaks a FOLLOWUPS marker split across deltas', () => {
    const out = run(['Answer', '\nFOLLOW', 'UPS: Is it ok? ', '\nCITATIONS: x'])
    expect(out.streamed).toBe('Answer')
    expect(out.parsed?.followups).toEqual(['Is it ok?'])
  })

  it('still parses citations when FOLLOWUPS is missing', () => {
    const out = run(['Hi there', '\nCITATIONS: x'])
    expect(out.parsed).toMatchObject({ citations: ['x'], followups: [] })
  })
})

describe('parseFollowups', () => {
  it('keeps at most 3 clean, unique questions and drops junk', () => {
    expect(
      parseFollowups(
        ' 1. What is Zig? | what is zig? [2] | not a question | ok? | Why does Rust win? | Is Go dead? | And Deno? ',
      ),
    ).toEqual(['What is Zig?', 'what is zig?', 'Why does Rust win?'])
    expect(parseFollowups('')).toEqual([])
    expect(parseFollowups(`${'x'.repeat(130)}?`)).toEqual([])
  })
})
