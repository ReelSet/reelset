import type { ReelProps } from './lib/types'

export const sampleProps: ReelProps = {
  durationSeconds: 6,
  title: 'Sample reel',
  source: 'github',
  sourceLabel: 'GitHub',
  domain: 'github.com/reelset/sample',
  audio: '',
  words: 'A short sample hook for the studio'
    .split(' ')
    .map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.28 })),
  scenes: [
    { kind: 'hook', start: 0, end: 2.4, text: 'A short sample hook for the studio' },
    {
      kind: 'beat',
      start: 2.4,
      end: 4.4,
      text: 'Stat',
      visual: { type: 'stat', label: 'GitHub stars', value: '12.4k' },
    },
    { kind: 'outro', start: 4.4, end: 6, text: 'Follow for more' },
  ],
}
