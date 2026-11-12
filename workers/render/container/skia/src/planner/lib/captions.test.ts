import { describe, expect, it } from 'vitest'
import { LAST_WORD_MAX_S, captionWord, highlightIndex, pageAt, toPages } from './captions'
import type { Word } from './types'

const words = (text: string): Word[] =>
  text.split(' ').map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }))

describe('toPages', () => {
  it('breaks on punctuation, word count and character budget', () => {
    const pages = toPages(words('Hello there, this is a longer sentence about stuff.'))
    expect(pages.map((p) => p.map((w) => w.text).join(' '))).toEqual([
      'Hello there,',
      'this is a longer',
      'sentence about stuff.',
    ])
  })

  it('keeps a single very long word on its own page', () => {
    const pages = toPages(words('Supercalifragilisticexpialidocious yes'), 4, 10)
    expect(pages.map((p) => p.length)).toEqual([1, 1])
  })
})

describe('caption fragments', () => {
  const text = (pages: { text: string }[][]) => pages.map((p) => p.map((w) => w.text).join(' '))

  it('does not end a page on a function word', () => {
    const out = text(toPages(words('and uses an RTX 5090 for a time of 49 minutes now'), 3, 22))
    expect(out.slice(0, -1).every((p) => !/\b(?:for|of|a|an)$/.test(p))).toBe(true)
  })

  it('moves the word before a lone number onto its page', () => {
    const out = text(
      toPages(words('hit on the Qwen3 run in Table 1. Then more words follow.'), 3, 22),
    )
    expect(out.some((p) => p.endsWith('Table 1.'))).toBe(true)
    expect(out.every((p) => p !== '1.')).toBe(true)
  })

  it('keeps a clause end where it is', () => {
    const out = text(toPages(words('We tried it, but it failed. Then the fix.'), 3, 22))
    expect(out[0]).toBe('We tried it,')
  })
})

describe('pageAt', () => {
  const pages = toPages(words('One two three four five six'), 3)

  it('finds the page being spoken and lingers briefly after its last word', () => {
    expect(pageAt(pages, 0.5)?.[0]?.text).toBe('One')
    expect(pageAt(pages, 1.18)?.[0]?.text).toBe('One')
    expect(pageAt(pages, 1.3)?.[0]?.text).toBe('four')
    expect(pageAt(pages, 2.5)?.[0]?.text).toBe('four')
  })

  it('shows nothing in silence beyond the linger', () => {
    expect(pageAt(pages, 2.8)).toBeNull()
    expect(pageAt([], 1)).toBeNull()
  })
})

describe('highlightIndex', () => {
  const page = (texts: string[]) => texts.map((text, i) => ({ text, start: i, end: i + 0.9 }))

  it('never boxes a function word; moves to the nearest content word', () => {
    expect(highlightIndex(page(['The', 'fix', 'is']), 0.2)).toBe(1)
    expect(highlightIndex(page(['The', 'fix', 'is']), 2.2)).toBe(1)
    expect(highlightIndex(page(['Since', 'November', '5,']), 0.1)).toBe(1)
    expect(highlightIndex(page(['This', 'change', 'was']), 0.5)).toBe(1)
    expect(highlightIndex(page(['DMARC', 'at', 'p=none']), 1.3)).toBe(0)
  })

  it('boxes the strongest word: names and numbers over plain words, nothing on fillers', () => {
    expect(highlightIndex(page(['Outlook.com', 'is', 'quietly']), 2.1)).toBe(0)
    expect(highlightIndex(page(['about', '20', 'minutes']), 2.1)).toBe(1)
    expect(highlightIndex(page(['and', 'it', 'is']), 1.1)).toBe(-1)
  })

  it('never boxes common verbs, quantifiers or version numbers', () => {
    expect(highlightIndex(page(['to', 'take', 'almost']), 1.1)).toBe(-1)
    expect(highlightIndex(page(['It', 'runs', 'on']), 1.1)).toBe(-1)
    expect(highlightIndex(page(['and', 'try', 'it']), 1.1)).toBe(-1)
    expect(highlightIndex(page(['is', 'one', 'DNS']), 1.1)).toBe(2)
    expect(highlightIndex(page(['PyTorch', '2.15.']), 1.1, 'to')).toBe(0)
    expect(highlightIndex(page(['2.15.']), 0.1, 'PyTorch')).toBe(-1)
    expect(highlightIndex(page(['Krea', '2', 'training']), 1.1, 'too.')).toBe(2)
  })
})

describe('caption words', () => {
  it('drops trailing commas, colons and full stops but keeps ? ! and inner dots', () => {
    expect(captionWord('distillation,')).toBe('distillation')
    expect(captionWord('2.15.')).toBe('2.15')
    expect(captionWord('hotmail.com,')).toBe('hotmail.com')
    expect(captionWord('why?')).toBe('why?')
    expect(captionWord('U.S.')).toBe('U.S.')
    expect(captionWord('...')).toBe('...')
  })

  it('never lingers on the silence an aligned last word runs into', () => {
    const w: Word[] = [
      { text: 'PyTorch', start: 19.15, end: 19.7 },
      { text: '2.15.', start: 19.7, end: 21.15 },
      { text: 'Training', start: 21.47, end: 21.8 },
    ]
    const pages = toPages(w, 3)
    expect(pageAt(pages, 19.8)?.[1]?.text).toBe('2.15.')
    expect(pageAt(pages, 19.7 + LAST_WORD_MAX_S + 0.4)).toBeNull()
  })
})
