import { describe, expect, it } from 'vitest'
import { itemTimes, listIn, revealLists } from './lists'
import type { ReelProps, TimedShot, Word } from './types'

const words = (text: string, start = 0, step = 0.4): Word[] =>
  text
    .split(' ')
    .map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.35 }))

describe('listIn', () => {
  it('finds a list of names and keeps the words that introduce it', () => {
    expect(
      listIn(
        'This affects mail to outlook.com, hotmail.com, live.com, or msn.com addresses if your domain lacks DMARC.',
      ),
    ).toEqual({
      kicker: 'Affects mail to',
      items: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    })
  })

  it('keeps multi-word items whole', () => {
    expect(listIn('DMARC prevents spoofing, phishing, and business email compromise.')).toEqual({
      kicker: 'DMARC prevents',
      items: ['spoofing', 'phishing', 'business email compromise'],
    })
  })

  it('ignores two-item phrases and clauses', () => {
    expect(listIn('It runs on consumer GPUs, down to eight gigabytes.')).toBeNull()
    expect(listIn('Fizgig trains, fixes and explores LoRAs.')).toBeNull()
  })
})

describe('itemTimes', () => {
  it('times each item by its first spoken word', () => {
    const w = words('affects mail to outlook.com, hotmail.com, live.com, or msn.com addresses')
    const at = itemTimes(w, ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], 0, 10)!
    expect(at.times.map((t) => Math.round(t * 10) / 10)).toEqual([1.2, 1.6, 2, 2.8])
    expect(at.end).toBeCloseTo(3.15)
  })

  it('gives up when an item is not in the voice', () => {
    expect(itemTimes(words('outlook.com and more'), ['outlook.com', 'gmail.com'], 0, 5)).toBeNull()
  })
})

describe('revealLists', () => {
  const text =
    'DMARC prevents spoofing, phishing, and business email compromise. Then more words follow here.'
  const w = words(text, 0, 0.35)
  const props = {
    durationSeconds: 6,
    title: 't',
    source: 'hn',
    sourceLabel: 'HN',
    domain: 'x.com',
    words: w,
    scenes: [{ kind: 'beat', start: 0, end: 6, text, visual: { type: 'title', title: 'x' } }],
  } as unknown as ReelProps
  const shot = (from: number, frames: number, text: string): TimedShot => ({
    from,
    frames,
    show: 'KeyPoint',
    props: { text },
    sceneIndex: 0,
    origin: 'planned',
  })

  it('replaces what was planned over the list with one card that lands items on the voice', () => {
    const out = revealLists(
      [shot(0, 60, 'a b'), shot(60, 60, 'c d'), shot(120, 60, 'e f')],
      props,
      30,
    )
    const card = out.find((s) => Array.isArray(s.props.items))!
    expect(card.props.items).toEqual(['spoofing', 'phishing', 'business email compromise'])
    expect(card.props.kicker).toBe('DMARC prevents')
    const times = card.props.times as number[]
    expect(times[0]).toBeGreaterThan(0)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    out.forEach((s, i) => i > 0 && expect(s.from).toBe(out[i - 1]!.from + out[i - 1]!.frames))
    expect(out.reduce((n, s) => n + s.frames, 0)).toBe(180)
  })
})
