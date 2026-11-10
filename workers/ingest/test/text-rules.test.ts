import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { completeCodeLines, displayValue, repairShots } from '../src/pipeline/shots'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const RENDER = '../../render/container/remotion/src/lib/'

describe('shared text rules', () => {
  it('ingest text-rules.ts is a verbatim copy of the renderer file', () => {
    expect(read('../src/pipeline/text-rules.ts')).toBe(read(`${RENDER}text-rules.ts`))
  })

  it('stat-labels.ts mirrors the renderer labels.ts', () => {
    const body = (s: string) => s.slice(s.indexOf('const NUM ='))
    expect(body(read('../src/pipeline/stat-labels.ts'))).toBe(body(read(`${RENDER}labels.ts`)))
  })
})

const beat = (text: string, shots: unknown[]) => ({ text, shots }) as Record<string, unknown>
const facts = new Set([94.7, 80.9, 12, 5090, 2.15, 20])

describe('repairShots (round-11 fragments)', () => {
  it('replaces a fragment key point with a claim of its sentence, or drops it', () => {
    const b = beat("But MOPD is a heavy pipeline and often doesn't recover all domains evenly.", [
      { at: 'heavy', show: 'KeyPoint', props: { text: 'Heavy pipeline' } },
      { at: 'domains', show: 'KeyPoint', props: { text: 'TAKE ALMOST' } },
    ])
    repairShots(b, facts, new Map())
    const texts = (b.shots as { props: { text: string } }[]).map((s) => s.props.text)
    expect(texts[0]).toBe('MOPD is a heavy pipeline')
    for (const t of texts) expect(t).not.toMatch(/TAKE ALMOST|^Heavy pipeline$/)
  })

  it('drops a key point with no claim to make', () => {
    const b = beat('Developers and companies are now scrambling to mitigate bounced emails.', [
      { at: 'bounced', show: 'KeyPoint', props: { text: 'Emails are Bouncing' } },
    ])
    repairShots(b, facts, new Map())
    expect(b.shots ?? []).toEqual([])
  })

  it('keeps a model key point that states something, as is', () => {
    const b = beat('P^2-MOPD treats a linear combination of parameters as one model.', [
      { at: 'linear', show: 'KeyPoint', props: { text: 'Treats parameters as one model' } },
      { at: 'model', show: 'KeyPoint', props: { text: 'Linear parameter combination' } },
    ])
    repairShots(b, facts, new Map())
    const texts = (b.shots as { props: { text: string } }[]).map((s) => s.props.text)
    expect(texts[0]).toBe('Treats parameters as one model')
    expect(texts).not.toContain('Linear parameter combination')
  })

  it('drops stats that are product or version numbers and writes "12 times" as 12×', () => {
    const b = beat(
      'On an RTX 5090 it moves to PyTorch 2.15 and the Muon optimizer runs 12 times faster.',
      [
        { at: 'RTX', show: 'StatSlam', props: { value: '5090', label: 'RTX' } },
        { at: 'PyTorch', show: 'StatSlam', props: { value: '2.15', label: 'PyTorch' } },
        { at: 'optimizer', show: 'StatSlam', props: { value: '12 times', label: 'faster' } },
      ],
    )
    repairShots(b, facts, new Map())
    const shots = b.shots as { props: { value: string } }[]
    expect(shots.map((s) => s.props.value)).toEqual(['12×'])
    expect(displayValue('3x')).toBe('3×')
  })
})

describe('completeCodeLines', () => {
  it('widens a code fragment to the full source line and drops fragments', () => {
    const source =
      'Publish this:\n_dmarc.example.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"\nDone.'
    expect(completeCodeLines('v=DMARC1; p=none;', source)).toBe(
      '_dmarc.example.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"',
    )
    expect(completeCodeLines('v=', '')).toBeNull()
    expect(completeCodeLines('v=DMARC1; p=none;', '')).toBe('v=DMARC1; p=none;')
  })
})
