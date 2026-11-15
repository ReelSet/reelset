import { describe, expect, it } from 'vitest'
import { githubSpamVerdict, type GithubSpamInput } from './github-spam'
import { LEGIT_REPOS, SPAM_REPOS } from './github-spam.fixtures'

const NOW = new Date('2026-11-12T00:00:00Z')

function titleOnly(fullName: string, stars: number): GithubSpamInput {
  return { fullName, stars, createdAt: '2026-11-08T00:00:00Z', now: NOW }
}

function repo(over: Partial<GithubSpamInput> = {}): GithubSpamInput {
  return {
    fullName: 'acme/fastq',
    description: 'A fast queue for Rust',
    topics: ['queue'],
    language: 'Rust',
    stars: 300,
    createdAt: '2026-11-05T00:00:00Z',
    now: NOW,
    ...over,
  }
}

describe('githubSpamVerdict on the real spam batch', () => {
  it('catches every hidden title from name, owner shape and stars alone', () => {
    const missed = SPAM_REPOS.filter(
      ([name, stars]) => !githubSpamVerdict(titleOnly(name, stars)).spam,
    )
    expect(missed.map(([name]) => name)).toEqual([])
  })

  it('never flags the legitimate repos', () => {
    const flagged = LEGIT_REPOS.flatMap(([name, stars]) => {
      const verdict = githubSpamVerdict(titleOnly(name, stars))
      return verdict.spam ? [{ name, reasons: verdict.reasons }] : []
    })
    expect(flagged).toEqual([])
  })
})

describe('githubSpamVerdict rules', () => {
  it('keeps ordinary repos', () => {
    expect(githubSpamVerdict(repo())).toMatchObject({ spam: false, reasons: [] })
  })

  it('lets the official owner use a brand name', () => {
    expect(githubSpamVerdict(repo({ fullName: 'adobe/adobe-fonts' }))).toMatchObject({
      spam: false,
    })
  })

  it('catches a copy of a famous project by a random owner but not by the canonical one', () => {
    const copy = githubSpamVerdict(titleOnly('ClipChiefSnips/scrcpy', 796))
    expect(copy.spam).toBe(true)
    expect(copy.reasons.join(' ')).toMatch(/well-known project/)
    expect(githubSpamVerdict(titleOnly('Genymobile/scrcpy', 796)).spam).toBe(false)
  })

  it('does not flag a brand name alone', () => {
    expect(githubSpamVerdict(repo({ fullName: 'jane/photoshop-scripts' })).spam).toBe(false)
  })

  it('needs more than a trading-bot name', () => {
    expect(githubSpamVerdict(repo({ fullName: 'quant-dev/crypto-trading-bot' })).spam).toBe(false)
  })

  it('treats organizations as exempt from owner-shape checks', () => {
    const input = repo({ fullName: 'WeldMoonBreed/exitlag', ownerType: 'Organization' })
    expect(githubSpamVerdict(input).spam).toBe(false)
  })

  it.each([
    'Free download full version with activation',
    'Photoshop 2026 cracked',
    'premium unlocked build',
  ])('flags spam wording in the description: %s', (description) => {
    expect(githubSpamVerdict(repo({ description })).spam).toBe(true)
  })

  it('flags repos with no description, topics or language', () => {
    const verdict = githubSpamVerdict(repo({ description: null, topics: [], language: null }))
    expect(verdict.reasons).toContain('no description, topics or language')
  })

  it('does not apply bare-repo rules when those fields are unknown', () => {
    expect(githubSpamVerdict(titleOnly('acme/fastq', 300)).spam).toBe(false)
  })

  it('flags implausible star velocity without a description', () => {
    const input = repo({
      description: null,
      topics: ['x'],
      stars: 5000,
      createdAt: '2026-11-11T20:00:00Z',
    })
    expect(githubSpamVerdict(input).reasons).toContain('implausible star velocity')
  })

  it('flags hundreds of stars on a days-old account', () => {
    const input = repo({
      fullName: 'newbie/fastq-tool',
      ownerCreatedAt: '2026-11-03T00:00:00Z',
      stars: 600,
      description: null,
      topics: [],
    })
    const verdict = githubSpamVerdict(input)
    expect(verdict.spam).toBe(true)
    expect(verdict.reasons.join(' ')).toMatch(/days old/)
  })

  it.each([
    'See [Download](https://example.com/setup.zip) to install',
    'Archive password: 1234',
    'Activation key included',
    'free download',
    'premium unlocked',
  ])('flags spam README wording: %s', (readme) => {
    expect(githubSpamVerdict(repo({ readme })).spam).toBe(true)
  })

  it('keeps a normal README', () => {
    expect(githubSpamVerdict(repo({ readme: '# fastq\nInstall with cargo add fastq.' })).spam).toBe(
      false,
    )
  })

  it('reports every reason that fired', () => {
    const verdict = githubSpamVerdict(titleOnly('PaladinSmash84/aida-64-extreme', 544))
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(2)
  })
})
