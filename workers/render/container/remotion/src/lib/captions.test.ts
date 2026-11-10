import { describe, expect, it } from 'vitest'
import { highlightIndex, pageAt, toPages } from './captions'
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
    expect(highlightIndex(page(['DMARC', 'at', 'p=none']), 1.3)).toBe(2)
  })

  it('keeps the spoken word when it carries meaning, and boxes nothing on a page of fillers', () => {
    expect(highlightIndex(page(['Outlook.com', 'is', 'quietly']), 2.1)).toBe(2)
    expect(highlightIndex(page(['and', 'it', 'is']), 1.1)).toBe(-1)
  })
})
