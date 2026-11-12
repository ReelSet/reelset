import { describe, expect, it } from 'vitest'
import { CONTENT_W } from '../theme'
import {
  itemTimes,
  kickerSize,
  listIn,
  listPieces,
  listSize,
  listTextWidth,
  revealLists,
} from './lists'
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

  it('finds a list without a serial comma and keeps its kicker short', () => {
    const list = listIn(
      'Fizgig is an open source studio for training, fixing and exploring LoRAs for image models like Flux, Qwen and SDXL.',
    )
    expect(list?.items).toEqual(['Flux', 'Qwen', 'SDXL'])
    expect(list!.kicker.split(' ').length).toBeLessThanOrEqual(4)
  })

  it('ignores a run whose item is only a number, since that is a count', () => {
    expect(listIn('The test used 94 pictures, Muon, and 70 epochs of training.')).toBeNull()
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

describe('listPieces', () => {
  it('keeps a list of three on one card over its last 4 s', () => {
    expect(listPieces(10, 14.7, [11.2, 12, 13.1])).toEqual([
      { from: 10.7, to: 14.7, first: 0, last: 3 },
    ])
  })

  it('splits a long list into two cards that each show their own items', () => {
    const p = listPieces(10, 17.6, [11.5, 13, 14.5, 16])!
    expect(p).toHaveLength(2)
    expect(p.map((x) => [x.first, x.last])).toEqual([
      [0, 2],
      [2, 4],
    ])
    for (const x of p) expect(x.to - x.from).toBeLessThanOrEqual(4)
  })
})

describe('listSize', () => {
  it('keeps every word inside the width and wraps long items between words', () => {
    const size = listSize(['spoofing', 'phishing', 'business email compromise'], 750, 600)
    expect('compromise'.length * 0.64 * size).toBeLessThanOrEqual(750)
    expect(size).toBeGreaterThan(70)
  })
})

describe('long lists', () => {
  it('gives the second card of a split list the other layout', () => {
    const text =
      'This affects mail to outlook.com, hotmail.com, live.com, or msn.com addresses if your domain lacks DMARC.'
    const ws: Word[] = text
      .split(' ')
      .map((t, i) => ({ text: t, start: i * 1.2, end: i * 1.2 + 0.6 }))
    const props = {
      durationSeconds: 24,
      words: ws,
      scenes: [{ kind: 'beat', start: 0, end: 24, text, visual: { type: 'title', title: 'x' } }],
    } as unknown as ReelProps
    const base: TimedShot[] = [
      {
        from: 0,
        frames: 600,
        show: 'KeyPoint',
        props: { text: '' },
        sceneIndex: 0,
        origin: 'planned',
      },
    ]
    const cards = revealLists(base, props, 30).filter((s) => Array.isArray(s.props.items))
    expect(cards.length).toBe(2)
    expect(cards[0]!.props.layout).toBeUndefined()
    expect(cards[1]!.props.layout).toBe(1)
  })
})

describe('list fitting inside the safe zone', () => {
  it('leaves room for the bullet and the right safe edge', () => {
    expect(listTextWidth(CONTENT_W)).toBeLessThan(CONTENT_W - 52)
  })

  it('never lets the widest word run past the item column', () => {
    const width = listTextWidth(CONTENT_W)
    const size = listSize(['team', 'urgency', 'refund status'], width, 900)
    expect(7 * 0.64 * size).toBeLessThanOrEqual(width)
  })

  it('shrinks a long kicker to one line within the content width', () => {
    const kicker = 'TICKET NEEDS THREE ANSWERS:'
    const px = kickerSize(kicker, CONTENT_W)
    expect(kicker.length * px * 0.72).toBeLessThanOrEqual(CONTENT_W)
    expect(kickerSize('Image models like', CONTENT_W)).toBe(46)
  })
})
