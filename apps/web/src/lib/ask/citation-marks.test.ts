import { describe, expect, it } from 'vitest'
import { dropUnknownMarks, splitAnswer, stripCitationMarks } from './citation-marks'

describe('dropUnknownMarks', () => {
  it('keeps marks that map to a cited source and removes the rest', () => {
    expect(dropUnknownMarks('A [1] B [4][2].', [{ refs: [1] }, { refs: [2, 3] }])).toBe(
      'A [1] B[2].',
    )
  })
})

describe('stripCitationMarks', () => {
  it('removes marks and the space before them', () => {
    expect(stripCitationMarks('Bun is fast [1][2]. Deno too [3].')).toBe('Bun is fast. Deno too.')
  })
})

describe('splitAnswer', () => {
  const citations = [{ refs: [1] }, { refs: [2, 5] }]

  it('merges adjacent marks into one citation part of source indexes', () => {
    expect(splitAnswer('Fast [1][2]. Slow.', citations)).toEqual([
      { type: 'text', text: 'Fast' },
      { type: 'cite', sources: [0, 1] },
      { type: 'text', text: '. Slow.' },
    ])
  })

  it('resolves merged refs to the same source and drops unknown marks', () => {
    expect(splitAnswer('A [5] B [9] C', citations)).toEqual([
      { type: 'text', text: 'A' },
      { type: 'cite', sources: [1] },
      { type: 'text', text: ' B C' },
    ])
  })

  it('returns plain text when there are no marks (older answers)', () => {
    expect(splitAnswer('No marks here', [])).toEqual([{ type: 'text', text: 'No marks here' }])
  })
})
