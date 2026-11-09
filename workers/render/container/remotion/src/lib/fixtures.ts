import type { ReelProps, Word } from './types'

export function wordsFrom(text: string, startAt = 0, per = 0.36): Word[] {
  let t = startAt
  return text.split(/\s+/).map((w) => {
    const dur = per + Math.min(w.length, 10) * 0.012
    const out = { text: w, start: t, end: t + dur }
    t += dur + (/[.?!]$/.test(w) ? 0.28 : /[,;:]$/.test(w) ? 0.14 : 0.04)
    return out
  })
}

const HOOK = 'Tired of AI-generated UIs looking, well, generic? Meet unslop, a skill that fixes them.'
const BEATS = [
  'Unslop is a skill for Claude Code, Codex, and other agents. It turns vibecoded interfaces into a designed one with 12 passes.',
  'It targets slop like purple gradients, glows, emoji labels, and uneven spacing. Then it sets a design direction from your product and fixes the screen pass by pass.',
  'To install, clone the repo and copy the skill into your skills folder. Then type slash unslop with your request or just ask your agent in plain words.',
]
const OUTRO = 'Say goodbye to generic AI aesthetics. Follow for more.'

export function sampleReel(over: Partial<ReelProps> = {}): ReelProps {
  const segs = [HOOK, ...BEATS, OUTRO]
  const words: Word[] = []
  const spans: [number, number][] = []
  let t = 0
  for (const s of segs) {
    const w = wordsFrom(s, t)
    words.push(...w)
    spans.push([t, w[w.length - 1]!.end + 0.05])
    t = w[w.length - 1]!.end + 0.05
  }
  const [hook, ...rest] = spans
  const beatSpans = rest.slice(0, -1)
  const outro = rest[rest.length - 1]!
  return {
    durationSeconds: outro[1] + 0.8,
    title: 'heydamir/unslop',
    source: 'github',
    sourceLabel: 'GitHub',
    domain: 'github.com/heydamir/unslop',
    audio: '',
    words,
    scenes: [
      { kind: 'hook', start: hook![0], end: hook![1], text: HOOK },
      {
        kind: 'beat',
        start: beatSpans[0]![0],
        end: beatSpans[0]![1],
        text: BEATS[0]!,
        visual: { type: 'title', title: 'Fixing AI-looking UI', subtitle: 'In 12 passes' },
      },
      {
        kind: 'beat',
        start: beatSpans[1]![0],
        end: beatSpans[1]![1],
        text: BEATS[1]!,
        visual: { type: 'title', title: 'Audit, Direction, Passes' },
      },
      {
        kind: 'beat',
        start: beatSpans[2]![0],
        end: beatSpans[2]![1],
        text: BEATS[2]!,
        visual: { type: 'code', language: 'bash', code: 'git clone https://github.com/heydamir/unslop' },
      },
      { kind: 'outro', start: outro[0], end: outro[1], text: OUTRO },
    ],
    images: [
      { src: 'job/img1.jpg', kind: 'og', width: 1280, height: 640 },
      { src: 'job/img2.jpg', kind: 'figure', width: 548, height: 600, alt: 'Figure 1: demo' },
    ],
    ...over,
  }
}
