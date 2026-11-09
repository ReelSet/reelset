import { describe, expect, it } from 'vitest'
import { POST_FIELDS } from '../src/config'
import { parseModelOutput, repairModelOutput, truncateAtWord } from '../src/pipeline/gemini'
import { SYSTEM_PROMPT } from '../src/pipeline/prompt'
import { readmeLooksSpammy, spamReason, type GithubRepo } from '../src/sources/github'
import { redditAdapter } from '../src/sources/reddit'
import { makeCtx } from './helpers/ctx'
import { json, testLog, useFetch } from './helpers/mock-fetch'

// Fields verified against the live Arctic Shift /api/posts endpoints. It answers HTTP 400
// ("'x' is not a valid field") for anything else, which failed every reddit task.
const ARCTIC_VERIFIED_POST_FIELDS = new Set([
  'id',
  'created_utc',
  'title',
  'selftext',
  'author',
  'score',
  'num_comments',
  'subreddit',
  'url',
  'over_18',
])

describe('arctic shift contract', () => {
  it('only requests post fields the API accepts', () => {
    for (const field of POST_FIELDS.split(',')) {
      expect(ARCTIC_VERIFIED_POST_FIELDS.has(field), field).toBe(true)
    }
    expect(POST_FIELDS).not.toContain('stickied')
  })
  it('sends that field list on the search request', async () => {
    const { calls } = useFetch((url) =>
      url.includes('/api/posts/search') ? json({ data: [] }) : undefined,
    )
    await redditAdapter.fetch('devops', testLog, makeCtx())
    const fields = new URL(calls[0]!).searchParams.get('fields')!.split(',')
    expect(fields.every((f) => ARCTIC_VERIFIED_POST_FIELDS.has(f))).toBe(true)
  })
})

const CHUNK = '11111111-1111-4111-8111-111111111111'
const output = (over: Record<string, unknown> = {}, script: Record<string, unknown> = {}) => ({
  tldr: 'Short.',
  topics: ['queues'],
  script: {
    version: 1,
    hook: 'Hook',
    beats: [
      { text: 'One', visual: { type: 'title', title: 'T' } },
      { text: 'Two', visual: { type: 'quote', text: 'Q', attribution: 'Someone' } },
    ],
    outro: 'Bye',
    claims: [{ text: 'Claim', chunkIds: [CHUNK] }],
    ...script,
  },
  ...over,
})

describe('gemini output repair', () => {
  const words = 'alpha beta gamma delta '.repeat(30)

  it('truncates at a word boundary within the limit', () => {
    const t = truncateAtWord(words, 100)
    expect(t.length).toBeLessThanOrEqual(100)
    expect(t.endsWith('\u2026')).toBe(true)
    expect(
      t
        .slice(0, -1)
        .split(' ')
        .every((w) => ['alpha', 'beta', 'gamma', 'delta'].includes(w)),
    ).toBe(true)
    expect(truncateAtWord('short', 100)).toBe('short')
  })

  it('accepts a tldr, hook and outro that are too long instead of failing', () => {
    const result = parseModelOutput(
      JSON.stringify(output({ tldr: words }, { hook: words, outro: words })),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tldr.length).toBeLessThanOrEqual(280)
      expect(result.value.script.hook.length).toBeLessThanOrEqual(120)
      expect(result.value.script.outro.length).toBeLessThanOrEqual(120)
    }
  })

  it('fills a missing quote attribution', () => {
    const bad = output(
      {},
      {
        beats: [
          { text: 'One', visual: { type: 'title', title: 'T' } },
          { text: 'Two', visual: { type: 'quote', text: 'Q' } },
        ],
      },
    )
    const result = parseModelOutput(JSON.stringify(bad))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.script.beats[1]!.visual).toMatchObject({ attribution: 'From the source' })
    }
  })

  it('trims beat, visual and topic overflow and extra beats', () => {
    const many = Array.from({ length: 8 }, () => ({
      text: 'x'.repeat(300),
      visual: { type: 'stat', label: words, value: words },
    }))
    const result = parseModelOutput(JSON.stringify(output({ topics: [words] }, { beats: many })))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.script.beats).toHaveLength(6)
  })

  it('still rejects structural problems and does not mutate non-objects', () => {
    expect(parseModelOutput(JSON.stringify(output({}, { beats: [] }))).ok).toBe(false)
    expect(repairModelOutput('x')).toBe('x')
  })

  it('tells the model the limits are hard', () => {
    expect(SYSTEM_PROMPT).toContain('hard limits')
  })
})

describe('github spam filter', () => {
  const repo = (over: Partial<GithubRepo> = {}): GithubRepo => ({
    id: 1,
    full_name: 'acme/fastq',
    html_url: 'https://github.com/acme/fastq',
    description: 'A fast queue for Rust',
    stargazers_count: 300,
    created_at: '2026-11-05T00:00:00Z',
    language: 'Rust',
    topics: ['queue'],
    ...over,
  })
  const now = new Date('2026-11-09T12:00:00Z')

  it('keeps ordinary repos', () => {
    expect(spamReason(repo(), now)).toBeNull()
  })
  it.each([
    'BeauticianChopper/adobe-acrobat-pro',
    'stellarlawyer/monero-miner',
    'x/photoshop-2026-cracked',
    'x/winrar_keygen',
  ])('flags %s', (full_name) => {
    expect(spamReason(repo({ full_name, description: null }), now)).not.toBeNull()
  })
  it('flags repos with no description, topics or language', () => {
    expect(spamReason(repo({ description: null, topics: [], language: null }), now)).toMatch(
      /no description/,
    )
  })
  it('flags crack words in the description', () => {
    expect(
      spamReason(repo({ description: 'Free download full version with activation' }), now),
    ).not.toBeNull()
  })
  it('flags spammy readmes only', () => {
    expect(readmeLooksSpammy('Download the crack and use password: 1234')).toBe(true)
    expect(readmeLooksSpammy('# fastq\nInstall with cargo add fastq.')).toBe(false)
  })
})
