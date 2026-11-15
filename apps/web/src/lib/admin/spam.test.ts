import { describe, expect, it } from 'vitest'
import { findSpamSuspects, type SpamScanRow } from './spam'

const NOW = new Date('2026-11-14T00:00:00Z')

function row(over: Partial<SpamScanRow>): SpamScanRow {
  return {
    id: 'id',
    title: 'acme/fastq',
    stars: 300,
    createdAt: '2026-11-10T00:00:00Z',
    author: null,
    facts: { description: 'A fast queue', language: 'Rust', topics: ['queue'] },
    readme: null,
    ...over,
  }
}

describe('findSpamSuspects', () => {
  it('flags the impostor batch and keeps real repos, strongest first', () => {
    const rows = [
      row({ id: 'real', title: 'Genymobile/scrcpy' }),
      row({ id: 'fake', title: 'ClipChiefSnips/scrcpy', stars: 796, facts: null }),
      row({ id: 'bait', title: 'WeldMoonBreed/exitlag', stars: 784, facts: {} }),
    ]
    const out = findSpamSuspects(rows, NOW)
    expect(out.map((s) => s.id).sort()).toEqual(['bait', 'fake'])
    expect(out[0]!.verdict.score).toBeGreaterThanOrEqual(out[1]!.verdict.score)
  })

  it('uses the stored README and description', () => {
    const rows = [
      row({ id: 'readme', readme: '[Setup](https://x.test/setup.zip) password: 1234' }),
      row({
        id: 'desc',
        facts: { description: 'Free download full version', language: 'C', topics: [] },
      }),
    ]
    expect(
      findSpamSuspects(rows, NOW)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['desc', 'readme'])
  })

  it('tolerates missing mention data', () => {
    expect(findSpamSuspects([row({ stars: null, facts: 'nope' })], NOW)).toEqual([])
  })
})
