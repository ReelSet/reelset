import { describe, expect, it } from 'vitest'
import { cleanSlop, slopPatterns } from '../src/pipeline/slop'

describe('cleanSlop', () => {
  it('swaps stock words for plain ones and keeps capitals', () => {
    expect(cleanSlop('Leverage this robust tool to streamline your work.').text).toBe(
      'Use this solid tool to simplify your work.',
    )
    expect(cleanSlop('It utilizes a cutting-edge model.').swaps).toEqual(
      expect.arrayContaining(['utilizes', 'cutting-edge']),
    )
  })

  it('deletes filler openers and tidies what is left', () => {
    expect(cleanSlop("Here's the thing, the model runs offline.").text).toBe(
      'The model runs offline.',
    )
    expect(cleanSlop('It is fast. Moreover, it is free.').text).toBe(
      'It is fast. Also, it is free.',
    )
    expect(cleanSlop('It works. Notably, it is free.').text).toBe('It works. It is free.')
  })

  it('turns an em dash into a comma but keeps number ranges', () => {
    expect(cleanSlop('It is fast — really fast.').text).toBe('It is fast, really fast.')
    expect(cleanSlop('Takes 5–10 minutes.').text).toBe('Takes 5–10 minutes.')
  })

  it('leaves a capitalised name in mid-sentence alone', () => {
    expect(cleanSlop('The repo Leverage ships a CLI.').text).toBe('The repo Leverage ships a CLI.')
  })

  it('does not touch words that only contain a listed word', () => {
    const text = 'The thusly-named package leverages_fn is unleashed.'
    expect(cleanSlop(text).text).toBe(text)
  })

  it('returns clean text unchanged', () => {
    const text = 'It shrinks the model so it runs on your laptop.'
    expect(cleanSlop(text)).toEqual({ text, swaps: [] })
  })
})

describe('slopPatterns', () => {
  it('reports sentence shapes that need a rewrite', () => {
    expect(slopPatterns("It's not just fast, it's free.")).toHaveLength(1)
    expect(slopPatterns('In this video we cover a tool. Follow for more.')).toHaveLength(2)
    expect(slopPatterns('It runs offline. In summary, it is good.')).toHaveLength(1)
    expect(slopPatterns('It shrinks the model so it runs on your laptop.')).toEqual([])
  })
})
