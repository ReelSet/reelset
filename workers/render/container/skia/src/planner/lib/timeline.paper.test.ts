import { describe, expect, it } from 'vitest'
import { sampleReel } from './fixtures'
import { comparisonFor, resolveShots } from './timeline'
import type { ReelProps, Shot } from './types'

function withShots(shots: Shot[]): ReelProps {
  const props = sampleReel()
  const scene = props.scenes[1]!
  if (scene.kind === 'beat') scene.shots = shots
  return props
}

const words = (props: ReelProps) => props.words.filter((w) => w.start >= props.scenes[1]!.start)

describe('paper screens on the timeline', () => {
  it('keeps a narrated table on screen past the normal hold, never over the 4 s QA limit', () => {
    const props = withShots([
      {
        at: 'designed',
        show: 'TableScreen',
        props: { headers: ['Tool', 'Passes'], rows: ['Baseline|3', 'unslop|12'] },
      },
    ])
    const { shots } = resolveShots(props, 30, Math.ceil(props.durationSeconds * 30))
    const table = shots.find((s) => s.show === 'TableScreen')!
    expect(table.props.value).toBe('12')
    expect(table.frames).toBeGreaterThanOrEqual(Math.round(2.6 * 30))
    expect(table.frames).toBeLessThanOrEqual(4 * 30)
  })

  it('never shows a table nobody narrates a number of', () => {
    const props = withShots([
      { at: 'x', show: 'TableScreen', props: { headers: ['a', 'b'], rows: ['x|1', 'y|7'] } },
    ])
    const { shots } = resolveShots(props, 30, Math.ceil(props.durationSeconds * 30))
    expect(shots.some((s) => s.show === 'TableScreen')).toBe(false)
  })

  it('skips a cue that would cut a table before it can be read', () => {
    const props = sampleReel()
    const ws = words(props)
    const second = ws[4]!
    const third = ws[5]!
    const scene = props.scenes[1]!
    if (scene.kind === 'beat') {
      scene.shots = [
        { at: ws[0]!.text, show: 'TableScreen', props: { headers: ['a', 'b'], rows: ['x|1'] } },
        { at: second.text, show: 'KeyPoint', props: { text: 'too soon' }, t: second.start },
        { at: third.text, show: 'KeyPoint', props: { text: 'later' }, t: third.start },
      ]
    }
    const { warnings } = resolveShots(props, 30, Math.ceil(props.durationSeconds * 30))
    expect(warnings.join('\n')).toContain('too close to a neighbour')
  })
})

describe('comparisons said in either order', () => {
  it('reads "20 minutes instead of 49" as bars Before 49 min, Now 20 min, timed as said', () => {
    const pair = comparisonFor('A MOSS-Image LoRA now takes about 20 minutes instead of 49.', 20)!
    expect(pair.bars.bars).toEqual([
      { label: 'Before', value: '49 min' },
      { label: 'Now', value: '~20 min' },
    ])
    expect(pair.saidLast).toEqual([1, 0])
    expect(pair.second.index).toBeGreaterThan(pair.first.index)
  })

  it('keeps "from 22.9 to 14.9" in bar order', () => {
    const pair = comparisonFor('Krea 2 training memory falls from 22.9 to 14.9 gigabytes.', 14.9)!
    expect(pair.bars.bars.map((b) => b.label)).toEqual(['Before', 'Now'])
    expect(pair.saidLast).toBeUndefined()
  })
})
