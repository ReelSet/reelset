import { describe, expect, it } from 'vitest'
import { chunkText, mentionChunks, transcriptChunks } from '../src/chunk'
import {
  buildEvidenceRows,
  hasEnoughEvidence,
  parseExtraTexts,
  selectPromptChunks,
} from '../src/pipeline/decide'

describe('chunkText', () => {
  it('returns [] for blank input', () => {
    expect(chunkText('  \n ')).toEqual([])
  })
  it('keeps short text as one chunk', () => {
    expect(chunkText('hello world')).toEqual(['hello world'])
  })
  it('merges small paragraphs up to the target', () => {
    const text = Array.from({ length: 5 }, (_, i) => `para ${i} ${'x'.repeat(100)}`).join('\n\n')
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.length).toBeLessThanOrEqual(800)
  })
  it('splits long text near sentence boundaries within 800 chars', () => {
    const sentence = 'This is a sentence about queues. '
    const chunks = chunkText(sentence.repeat(100))
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('This is a sentence about queues.')
  })
  it('hard-splits text with no spaces', () => {
    const chunks = chunkText('a'.repeat(2000))
    expect(chunks.map((c) => c.length)).toEqual([800, 800, 400])
  })
})

describe('mentionChunks / transcriptChunks', () => {
  it('puts the title with the body then appends extra texts', () => {
    const chunks = mentionChunks({
      title: 'T',
      body: 'B',
      extraTexts: ['comment one', 'comment two'],
    })
    expect(chunks).toEqual(['T\n\nB', 'comment one', 'comment two'])
  })
  it('caps chunks per mention', () => {
    const extra = Array.from({ length: 50 }, (_, i) => `c${i}`)
    expect(mentionChunks({ title: null, body: null, extraTexts: extra })).toHaveLength(12)
  })
  it('caps transcript chunks', () => {
    expect(transcriptChunks('word '.repeat(10_000))).toHaveLength(16)
  })
})

describe('buildEvidenceRows', () => {
  const mentions = [
    { id: 'm1', source: 'hn', title: 'Title', body: null, extraTexts: ['a'.repeat(200)] },
    { id: 'm2', source: 'youtube', title: 'Vid', body: 'desc', extraTexts: [] },
  ]
  it('numbers chunks per mention', () => {
    const rows = buildEvidenceRows(mentions, null)
    expect(rows.filter((r) => r.mentionId === 'm1').map((r) => r.chunkIndex)).toEqual([0, 1])
    expect(rows.filter((r) => r.mentionId === 'm2').map((r) => r.chunkIndex)).toEqual([0])
  })
  it('attaches the transcript to the youtube mention after its own chunks', () => {
    const rows = buildEvidenceRows(mentions, 'spoken words '.repeat(100))
    const yt = rows.filter((r) => r.mentionId === 'm2')
    expect(yt[0]!.text).toBe('Vid\n\ndesc')
    expect(yt.length).toBeGreaterThan(1)
    expect(yt.map((r) => r.chunkIndex)).toEqual(yt.map((_, i) => i))
    expect(rows.filter((r) => r.mentionId === 'm1')).toHaveLength(2)
  })
  it('attaches the transcript to the first mention when no youtube mention exists', () => {
    const rows = buildEvidenceRows([mentions[0]!], 'spoken '.repeat(200))
    expect(rows.length).toBeGreaterThan(2)
  })
  it('flags thin evidence', () => {
    expect(
      hasEnoughEvidence(
        buildEvidenceRows(
          [{ id: 'x', source: 'hn', title: 'Short', body: null, extraTexts: [] }],
          null,
        ),
      ),
    ).toBe(false)
    expect(hasEnoughEvidence(buildEvidenceRows(mentions, null))).toBe(true)
  })
})

describe('misc decide helpers', () => {
  it('parses extraTexts defensively', () => {
    expect(parseExtraTexts(null)).toEqual([])
    expect(parseExtraTexts({ extraTexts: 'nope' })).toEqual([])
    expect(parseExtraTexts({ extraTexts: ['a', 1, 'b'] })).toEqual(['a', 'b'])
  })
  it('limits prompt chunks by count and size', () => {
    const many = Array.from({ length: 100 }, () => ({ text: 'x'.repeat(100) }))
    expect(selectPromptChunks(many)).toHaveLength(40)
    const big = Array.from({ length: 10 }, () => ({ text: 'x'.repeat(10_000) }))
    expect(selectPromptChunks(big)).toHaveLength(2)
  })
})
