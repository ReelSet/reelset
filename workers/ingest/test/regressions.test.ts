import { describe, expect, it } from 'vitest'
import { POST_FIELDS } from '../src/config'
import { parseModelOutput, repairModelOutput, truncateAtWord } from '../src/pipeline/output'
import { SYSTEM_PROMPT } from '../src/pipeline/prompt'
import { repoSpamVerdict, type GithubRepo } from '../src/sources/github'
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

  it('trims a tldr that is too long instead of failing', () => {
    const result = parseModelOutput(JSON.stringify(output({ tldr: words })))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tldr.length).toBeLessThanOrEqual(280)
  })

  it('keeps a long hook and outro whole instead of cutting the sentence', () => {
    const hook =
      'You can train your own tiny language model at home, and the fine-tuning step took about two hours on one graphics card.'
    const outro =
      'So save this one and try it this weekend, because two hours on one graphics card is a lot less than people think it is.'
    const result = parseModelOutput(JSON.stringify(output({}, { hook, outro })))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.script.hook).toBe(hook)
      expect(result.value.script.outro).toBe(outro)
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

  it('trims visual and topic overflow', () => {
    const beats = [
      { text: 'One', visual: { type: 'stat', label: words, value: words } },
      { text: 'Two', visual: { type: 'title', title: words } },
    ]
    const result = parseModelOutput(JSON.stringify(output({ topics: [words] }, { beats })))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.topics[0]!.length).toBeLessThanOrEqual(40)
  })

  it('keeps a long beat whole on the first try', () => {
    const long = 'And that two hours covers only one step, which is kind of annoying. '
      .repeat(4)
      .trim()
    const beats = [
      { text: 'One', visual: { type: 'title', title: 'T' } },
      { text: long, visual: { type: 'title', title: 'T' } },
    ]
    const result = parseModelOutput(JSON.stringify(output({}, { beats })))
    expect(long.length).toBeGreaterThan(220)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.script.beats[1]!.text).toBe(long)
  })

  it('still drops beats past the sixth', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      text: `Beat ${i}`,
      visual: { type: 'title', title: 'T' },
    }))
    const result = parseModelOutput(JSON.stringify(output({}, { beats: many })))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.script.beats).toHaveLength(6)
  })

  it('accepts spoken text at the caps and rejects it past them, never cutting it', () => {
    const beats = (text: string) => [
      { text, visual: { type: 'title', title: 'T' } },
      { text: 'Two', visual: { type: 'title', title: 'T' } },
    ]
    const at = output(
      {},
      { hook: 'h'.repeat(240), outro: 'o'.repeat(240), beats: beats('b'.repeat(400)) },
    )
    expect(parseModelOutput(JSON.stringify(at)).ok).toBe(true)
    const past = parseModelOutput(JSON.stringify(output({}, { beats: beats('b'.repeat(401)) })))
    expect(past.ok).toBe(false)
    if (!past.ok) expect(past.reason).toContain('script.beats.0.text')
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
    expect(repoSpamVerdict(repo(), now).spam).toBe(false)
  })
  it.each([
    'BeauticianChopper/adobe-acrobat-pro',
    'stellarlawyer/monero-miner',
    'x/photoshop-2026-cracked',
    'x/winrar_keygen',
  ])('flags %s', (full_name) => {
    expect(repoSpamVerdict(repo({ full_name, description: null }), now).spam).toBe(true)
  })
  it('flags repos with no description, topics or language', () => {
    expect(
      repoSpamVerdict(repo({ description: null, topics: [], language: null }), now).reasons,
    ).toContain('no description, topics or language')
  })
  it('flags crack words in the description', () => {
    expect(
      repoSpamVerdict(repo({ description: 'Free download full version with activation' }), now)
        .spam,
    ).toBe(true)
  })
  it('flags spammy readmes only', () => {
    const spammy = 'Download the crack and use password: 1234'
    expect(repoSpamVerdict(repo(), now, spammy).spam).toBe(true)
    expect(repoSpamVerdict(repo(), now, '# fastq\nInstall with cargo add fastq.').spam).toBe(false)
  })
})
