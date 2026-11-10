import { describe, expect, it } from 'vitest'
import { corpusOf, namesOf, spokenIn, wordsIn } from './numbers'
import { identityOf } from './planner'
import { readTable } from './table'
import {
  isCompleteCodeLine,
  isQuantityValue,
  quantityValue,
  sameNumber,
  validKeyPoint,
} from './text-rules'
import { SOURCE_CAP, SOURCE_SCREENS } from './sources'
import { resolveShots, totalFrames } from './timeline'
import type { ReelProps, TimedShot } from './types'
import fizgig from './samples/fizgig.json'
import mopd from './samples/mopd.json'
import outlook from './samples/outlook.json'

// Round-11 sample reels (stored scripts + Aura word timings) that looked amateur; see docs/contracts.md.
const FPS = 30
const SAMPLES = { mopd, outlook, fizgig } as unknown as Record<string, ReelProps>
const plan = (p: ReelProps) => resolveShots(p, FPS, totalFrames(p.durationSeconds, FPS)).shots
/** Shots as the viewer counts looks: a punch-in continues the shot before it. */
const viewed = (shots: TimedShot[]) => shots.filter((s) => !s.props.punch)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

describe.each(Object.entries(SAMPLES))('sample reel %s', (_name, props) => {
  const shots = plan(props)
  const scene = (s: TimedShot) => props.scenes[s.sceneIndex]
  const sceneText = (s: TimedShot) => {
    const sc = scene(s)
    return sc && 'text' in sc ? sc.text : ''
  }

  it('covers the reel with holds of at most 4 s', () => {
    shots.forEach((s, i) => {
      expect(s.frames / FPS, `${s.show} at ${s.from / FPS}`).toBeLessThanOrEqual(4)
      if (i > 0) expect(s.from).toBe(shots[i - 1]!.from + shots[i - 1]!.frames)
    })
    const avg = shots.reduce((n, s) => n + s.frames, 0) / FPS / shots.length
    expect(avg).toBeLessThanOrEqual(2.5)
  })

  it('shows each source card look once and the card at most 3 times', () => {
    for (const show of SOURCE_SCREENS) {
      const cards = viewed(shots).filter((s) => s.show === show)
      expect(cards.length).toBeLessThanOrEqual(SOURCE_CAP)
      const looks = cards.map((s) => str(s.props.variant) || 'title')
      expect(new Set(looks).size).toBe(looks.length)
    }
  })

  it('never shows an identical look twice', () => {
    const ids = viewed(shots)
      .filter((s) => s.show !== 'RepoDemo')
      .map((s) => identityOf(s.show, s.props))
    expect(ids.length - new Set(ids).size).toBe(0)
  })

  it('only puts complete ideas on key points', () => {
    const names = namesOf(props)
    for (const s of shots.filter((x) => x.show === 'KeyPoint' && !x.props.quote)) {
      const text = str(s.props.text)
      if (!text) {
        expect(typeof s.props.bg, 'caption-only shot needs footage').toBe('number')
        continue
      }
      const ok = validKeyPoint(text, { names, allowVerbStart: true, allowParticipleStart: true })
      expect(ok, text).toBe(text)
    }
  })

  it('shows each number once, as a real quantity found in the sources, with a label', () => {
    const stats = viewed(shots).filter((s) => s.show === 'StatSlam')
    const values = stats.map((s) => quantityValue(str(s.props.value)))
    expect(new Set(values).size).toBe(values.length)
    const corpus = corpusOf(props).join(' ')
    for (const s of stats) {
      const value = str(s.props.value)
      expect(isQuantityValue(value), value).toBe(true)
      expect(corpus).toContain(/\d[\d,.]*/.exec(value)![0])
      expect(str(s.props.label).length).toBeGreaterThan(2)
    }
  })

  it('highlights the table cell that is being narrated', () => {
    for (const s of shots.filter((x) => x.show === 'TableScreen')) {
      const view = readTable(s.props)!
      const spoken = wordsIn(props.words, s.from / FPS - 0.3, (s.from + s.frames) / FPS)
      const said = spokenIn(sceneText(s), spoken)
      if (said.length > 0) expect(said.some((q) => sameNumber(q.raw, view.value))).toBe(true)
    }
  })

  it('shows code only as complete lines', () => {
    for (const s of shots.filter((x) => x.show === 'CodeBlock')) {
      for (const line of str(s.props.code).split('\n'))
        expect(isCompleteCodeLine(line), line).toBe(true)
    }
  })
})

describe('sample specifics', () => {
  it('mopd: 94.7% and 80.9% are one comparison that names P²-MOPD and MOPD, shown once', () => {
    const shots = plan(SAMPLES.mopd!)
    const bars = shots.filter((s) => s.show === 'BarRace')
    expect(bars.length).toBeGreaterThan(0)
    for (const b of bars) {
      expect(b.props.title).toBe('average recovery')
      expect(b.props.bars).toEqual([
        { label: 'P^2-MOPD', value: '94.7%' },
        { label: 'MOPD', value: '80.9%' },
      ])
    }
    const slams = shots.filter((s) => s.show === 'StatSlam').map((s) => str(s.props.value))
    expect(slams).not.toContain('94.7%')
    expect(slams).not.toContain('80.9%')
    expect(slams).toContain('~90%')
    expect(shots.some((s) => s.show === 'TableScreen' && str(s.props.value) === '78.74')).toBe(
      false,
    )
  })

  it('mopd: no model size, lone name or bare label as a key point', () => {
    const texts = plan(SAMPLES.mopd!)
      .filter((s) => s.show === 'KeyPoint')
      .map((s) => str(s.props.text))
    for (const bad of ['1.7B model', 'P^2-MOPD', 'Linear parameter combination', 'expert weights'])
      expect(texts).not.toContain(bad)
    expect(texts).toContain('MOPD is a heavy pipeline')
  })

  it('outlook: the mailbox domains are one list card that fills in with the voice', () => {
    const lists = plan(SAMPLES.outlook!).filter((s) => Array.isArray(s.props.items))
    const domains = lists.filter((s) => (s.props.items as string[]).includes('live.com'))
    expect(domains.length).toBeGreaterThan(0)
    for (const s of domains) {
      expect(s.props.items).toEqual(['outlook.com', 'hotmail.com', 'live.com', 'msn.com'])
      expect(s.frames / FPS).toBeLessThanOrEqual(4)
    }
    const texts = plan(SAMPLES.outlook!).map((s) => str(s.props.text))
    for (const bad of ['SPF', 'DMARC', 'outlook.com', 'hotmail.com', 'msn.com'])
      expect(texts).not.toContain(bad)
  })

  it('outlook: the DMARC record is shown whole, once', () => {
    const code = plan(SAMPLES.outlook!).filter((s) => s.show === 'CodeBlock')
    expect(code).toHaveLength(1)
    expect(str(code[0]!.props.code)).toBe('v=DMARC1; p=none;')
  })

  it('fizgig: the demo plays over "watch the tour"; the outro names the repo', () => {
    const shots = plan(SAMPLES.fizgig!)
    const watch = SAMPLES.fizgig!.words.find((w) => /^watch$/i.test(w.text))!
    const t = watch.start + 0.1
    const over = shots.find((s) => s.from / FPS <= t && (s.from + s.frames) / FPS > t)
    expect(over?.show).toBe('RepoDemo')
    const texts = shots.map((s) => str(s.props.text))
    expect(texts).not.toContain('GitHub')
    expect(texts).not.toContain('twenty minutes')
    expect(texts).not.toContain('eight gigabytes')
  })

  it('fizgig: no weak social proof slammed; sizes say what was measured', () => {
    const shots = plan(SAMPLES.fizgig!)
    expect(shots.some((s) => s.show === 'RedditPost' && s.props.variant === 'stats')).toBe(false)
    const memory = shots.find((s) => s.show === 'BarRace')
    expect(str(memory?.props.title)).toMatch(/memory/i)
    const twenty = shots.find((s) => s.show === 'StatSlam' && /20/.test(str(s.props.value)))
    expect(str(twenty?.props.label)).toContain('was 49 min')
  })

  it('fizgig: no product or version numbers as stats; "12 times" reads 12×', () => {
    const shots = plan(SAMPLES.fizgig!)
    const values = shots.filter((s) => s.show === 'StatSlam').map((s) => str(s.props.value))
    for (const bad of ['5090', '2.15', '1', '2']) expect(values).not.toContain(bad)
    for (const v of values) if (/^12/.test(v)) expect(v).toBe('12×')
  })
})
