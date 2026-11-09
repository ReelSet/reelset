import { describe, expect, it } from 'vitest'
import { sampleReel } from './fixtures'
import { resolveShots } from './timeline'
import type { ReelProps, Shot } from './types'

function withShots(shots: Shot[]): ReelProps {
  const props = sampleReel()
  const scene = props.scenes[1]!
  if (scene.kind === 'beat') scene.shots = shots
  return props
}

const words = (props: ReelProps) => props.words.filter((w) => w.start >= props.scenes[1]!.start)

describe('paper screens on the timeline', () => {
  it('keeps a table on screen past the normal hold before filling', () => {
    const props = withShots([
      { at: 'x', show: 'TableScreen', props: { headers: ['a', 'b'], rows: ['x|1'] } },
    ])
    const { shots } = resolveShots(props, 30, Math.ceil(props.durationSeconds * 30))
    const table = shots.find((s) => s.show === 'TableScreen')!
    expect(table.frames).toBeGreaterThanOrEqual(Math.round(3.7 * 30))
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
