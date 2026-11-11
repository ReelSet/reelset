import { describe, expect, it } from 'vitest'
import { parseModelOutput } from '../src/pipeline/output'

const CHUNK = '11111111-1111-4111-8111-111111111111'
const validOutput = {
  tldr: 'A short summary.',
  topics: ['Queues', 'queues', 'Workers'],
  script: {
    version: 1,
    hook: 'Hook',
    beats: [
      { text: 'One', visual: { type: 'title', title: 'T' } },
      { text: 'Two', visual: { type: 'stat', label: 'L', value: '1' } },
    ],
    outro: 'Bye',
    claims: [{ text: 'Claim', chunkIds: [CHUNK] }],
  },
}

describe('parseModelOutput', () => {
  it('parses valid JSON and dedupes lowercase topics', () => {
    const result = parseModelOutput(JSON.stringify(validOutput))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.topics).toEqual(['queues', 'workers'])
  })
  it('strips markdown fences', () => {
    expect(parseModelOutput('```json\n' + JSON.stringify(validOutput) + '\n```').ok).toBe(true)
  })
  it('reports invalid JSON', () => {
    const result = parseModelOutput('Sure! Here is your script: {')
    expect(result).toEqual({ ok: false, reason: 'response was not valid JSON' })
  })
  it('reports schema mismatches with the failing paths', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, beats: [validOutput.script.beats[0]] },
    }
    const result = parseModelOutput(JSON.stringify(bad))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('script.beats')
  })
  it('trims a tldr over 280 chars at a word boundary instead of rejecting it', () => {
    const result = parseModelOutput(JSON.stringify({ ...validOutput, tldr: 'word '.repeat(100) }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tldr.length).toBeLessThanOrEqual(280)
  })
  it('rejects non-uuid chunk ids', () => {
    const bad = {
      ...validOutput,
      script: { ...validOutput.script, claims: [{ text: 'c', chunkIds: ['chunk-1'] }] },
    }
    expect(parseModelOutput(JSON.stringify(bad)).ok).toBe(false)
  })
})
