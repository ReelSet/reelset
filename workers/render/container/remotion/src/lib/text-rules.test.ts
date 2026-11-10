import { describe, expect, it } from 'vitest'
import {
  claimPhrases,
  findQuantities,
  hasPredicate,
  isClaimLike,
  isCompleteCodeLine,
  isQuantityValue,
  isVerbForm,
  keyPointText,
  nameSet,
  nounChunks,
  numberLabel,
  sameNumber,
  validKeyPoint,
} from './text-rules'

describe('validKeyPoint', () => {
  const names = nameSet('Moss training has a very large speed boost in Fizgig')

  it.each([
    'Linear parameter combination',
    'Heavy pipeline',
    'No Official Announcement',
    'Requires SPF or DKIM Alignment',
    'eight gigabytes',
    'Less memory, faster Muon',
    'MOPD: Heavy & Uneven',
  ])('keeps a complete idea: %s', (t) => {
    expect(validKeyPoint(t, { names, allowVerbStart: true })).toBe(t.replace(/[.,]$/, ''))
  })

  it.each([
    'P²-MOPD makes',
    'TAKE ALMOST',
    'A',
    'priors',
    'Watch',
    'raised worst-domain',
    'many Developers',
    'compromise Authenticated',
    'addresses if',
    'DKIM aligns',
    '94.7% average',
    'times faster',
    'without retraining',
    'Emails are Bouncing',
    'one two three four five six seven',
    'DMARC',
    'P²-MOPD',
    'GitHub',
    'SPF',
  ])('rejects a fragment: %s', (t) => {
    expect(validKeyPoint(t, { names })).toBeNull()
  })

  it('strips trailing punctuation; a lone name is never a key point', () => {
    expect(validKeyPoint('Affects @outlook.com, @hotmail.com,', { allowVerbStart: true })).toBe(
      'Affects @outlook.com, @hotmail.com',
    )
    expect(validKeyPoint('Fizgig.', { names })).toBeNull()
  })
})

describe('claims', () => {
  it.each([
    [
      "But MOPD is a heavy pipeline and often doesn't recover all domains evenly.",
      'MOPD is a heavy pipeline',
    ],
    ['This method uses experts as parameter priors.', 'Uses experts as parameter priors'],
    [
      'It jointly optimizes mixing coefficients and student weights.',
      'Optimizes mixing coefficients and student weights',
    ],
    [
      'You can also fix a broken LoRA block by block without retraining, and find the best epoch by eye.',
      'Fix a broken LoRA block',
    ],
    [
      'Outlook.com is quietly rejecting emails from domains without DMARC records.',
      'Outlook.com is rejecting emails',
    ],
    [
      'Authenticated domains are much harder to impersonate.',
      'Authenticated domains are harder to impersonate',
    ],
    ['The fix is one DNS record.', 'The fix is one DNS record'],
    ['Check out shootthesound slash Fizgig on GitHub.', 'Check out shootthesound/Fizgig on GitHub'],
  ])('states the claim of %s', (sentence, claim) => {
    expect(claimPhrases(sentence)[0]).toBe(claim)
  })

  it.each([
    'For a 1.7B model, P^2-MOPD achieved 94.7% average recovery.',
    'Now it takes twenty minutes.',
    'It runs on consumer GPUs, down to eight gigabytes.',
    'P^2-MOPD makes expert weights a source of supervision.',
    'DMARC passes if SPF or DKIM aligns with your From address domain.',
  ])('makes no claim out of a number or a cut-off clause: %s', (sentence) => {
    const out = claimPhrases(sentence)
    for (const c of out) expect(c).not.toMatch(/\d|twenty|eight|a source$|if SPF$/)
  })

  it('tells a claim from a label', () => {
    for (const t of [
      'Optimizes coefficients and weights',
      'MOPD: Heavy & Uneven',
      'No Official Announcement',
    ])
      expect(isClaimLike(t), t).toBe(true)
    for (const t of [
      'Heavy pipeline',
      'Linear parameter combination',
      'expert weights',
      'SPF',
      '1.7B model',
      'twenty minutes',
    ])
      expect(isClaimLike(t), t).toBe(false)
    expect(isClaimLike('Fix and explore', 'Block-level LoRA repair, epoch compare')).toBe(true)
    expect(isClaimLike('Less memory, faster Muon', 'Krea 2: 22.9 to 14.9 GB')).toBe(false)
    expect(hasPredicate('DMARC prevents spoofing')).toBe(true)
  })
})

describe('verbs', () => {
  it('flags inflected verbs, not nouns', () => {
    for (const v of ['makes', 'raised', 'surpassing', 'took', 'accelerates', 'aligns', 'achieved'])
      expect(isVerbForm(v), v).toBe(true)
    for (const n of ['training', 'weights', 'pipeline', 'release', 'spoofing', 'records', 'emails'])
      expect(isVerbForm(n), n).toBe(false)
  })
})

describe('nounChunks', () => {
  it('finds the noun phrase of a sentence', () => {
    expect(nounChunks('Training an image model LoRA used to take almost an hour.')[0]).toBe(
      'image model LoRA',
    )
    expect(
      nounChunks('Developers and companies are now scrambling to mitigate bounced emails.'),
    ).toContain('bounced emails')
    expect(nounChunks('The fix is one DNS record.')[0]).toBe('one DNS record')
  })

  it('never crosses a sentence or ends on a verb', () => {
    for (const c of nounChunks(
      'causing problems for many. Developers and companies are now scrambling',
    ))
      expect(c).not.toMatch(/many Developers/)
    for (const c of nounChunks(
      'P^2-MOPD makes expert weights a source of supervision, guiding the student.',
    ))
      expect(validKeyPoint(c)).toBe(c)
  })

  it('keeps "X of Y" together', () => {
    expect(nounChunks('expert weights a source of supervision')).toContain('source of supervision')
  })
})

describe('keyPointText', () => {
  it('prefers the given claim, then a short matching claim, then a claim of the sentence, else null', () => {
    expect(keyPointText({ given: 'Uses experts as priors', text: 'x' })).toBe(
      'Uses experts as priors',
    )
    expect(keyPointText({ given: 'Heavy pipeline', text: 'x' })).toBeNull()
    expect(
      keyPointText({
        given: 'Heavy pipeline',
        text: 'heavy pipeline and often',
        context: "But MOPD is a heavy pipeline and often doesn't recover all domains evenly.",
      }),
    ).toBe('MOPD is a heavy pipeline')
    expect(
      keyPointText({
        given: 'Emails are Bouncing',
        claims: ['The change was unannounced.'],
        text: 'mitigate bounced emails.',
      }),
    ).toBeNull()
    expect(
      keyPointText({
        given: 'P^2-MOPD makes',
        claims: ['Expert weights guide distillation.'],
        text: 'guide the student and expert weights',
      }),
    ).toBe('Expert weights guide distillation')
    expect(keyPointText({ text: 'and it is' })).toBeNull()
  })

  it('skips texts already used', () => {
    expect(
      keyPointText({
        text: 'rejecting emails',
        context: 'Outlook.com is quietly rejecting emails.',
        avoid: new Set(['Outlook.com is rejecting emails']),
      }),
    ).toBeNull()
  })
})

describe('findQuantities', () => {
  const raws = (t: string) => findQuantities(t).map((q) => q.raw)

  it('keeps real quantities', () => {
    expect(raws('P^2-MOPD achieved 94.7% average recovery, surpassing 80.9%.')).toEqual([
      '94.7%',
      '80.9%',
    ])
    expect(raws('the Muon optimizer runs 12 times faster')).toEqual(['12×'])
    expect(raws('takes about 20 minutes instead of 49')).toEqual(['~20 min'])
    expect(raws('raised worst-domain recovery to nearly 90%')).toEqual(['~90%'])
    expect(raws('over 1,000 stars')).toEqual(['>1,000 stars'])
    expect(raws('falls from 22.9 to 14.9 GB')).toEqual(['14.9GB'])
    expect(raws('It has 1,240 stars and 3x speed')).toEqual(['1,240 stars', '3×'])
  })

  it('skips model, product, version and date numbers', () => {
    expect(raws('On an RTX 5090 it flies')).toEqual([])
    expect(raws('GPT-4 and Qwen3 and M3 chips')).toEqual([])
    expect(raws('moves to PyTorch 2.15. Training')).toEqual([])
    expect(raws('For a 1.7B model, it won')).toEqual([])
    expect(raws('Since November 5, 2026, mail fails')).toEqual([])
    expect(raws('version 3.2 ships, v1.2.3 too')).toEqual([])
    expect(raws('the 3rd run in 2025')).toEqual([])
  })

  it('never splits a number into a smaller one', () => {
    expect(raws('runs 12 times faster')).not.toContain('1')
  })
})

describe('values', () => {
  it('accepts only one quantity as a stat value', () => {
    expect(isQuantityValue('94.7%')).toBe(true)
    expect(isQuantityValue('12×')).toBe(true)
    expect(isQuantityValue('20 min')).toBe(true)
    expect(isQuantityValue('Nov 5, 2026')).toBe(false)
    expect(isQuantityValue('RTX 5090')).toBe(false)
    expect(isQuantityValue('2.15')).toBe(true)
  })

  it('matches a narrated number to a table cell at the narrated precision', () => {
    expect(sameNumber('80.9%', '80.93')).toBe(true)
    expect(sameNumber('94.7%', '94.74±0.91')).toBe(true)
    expect(sameNumber('94.7%', '94.85')).toBe(false)
    expect(sameNumber('80.9', '78.74')).toBe(false)
  })
})

describe('isCompleteCodeLine', () => {
  it('rejects fragments', () => {
    expect(isCompleteCodeLine('v=')).toBe(false)
    expect(isCompleteCodeLine('const x = foo(')).toBe(false)
    expect(isCompleteCodeLine('"v=DMARC1; p=none')).toBe(false)
    expect(isCompleteCodeLine('v=DMARC1; p=none;')).toBe(true)
    expect(isCompleteCodeLine('_dmarc.example.com TXT "v=DMARC1; p=none; rua=mailto:a@b.c"')).toBe(
      true,
    )
  })
})

describe('numberLabel', () => {
  const label = (s: string, n: string) => {
    const i = s.indexOf(n)
    return numberLabel(s, { start: i, end: i + n.length })
  }
  it('reads what the sentence says the number is', () => {
    const s = "For a 1.7B model, P^2-MOPD achieved 94.7% average recovery, surpassing MOPD's 80.9%."
    expect(label(s, '94.7%')).toBe('P^2-MOPD average recovery')
    expect(label(s, '80.9%')).toBe('MOPD average recovery')
    expect(label('our model reaches 94.7% average recovery, versus 80.9% for MOPD.', '80.9%')).toBe(
      'MOPD average recovery',
    )
    expect(label('and the Muon optimizer runs 12 times faster.', '12')).toBe(
      'faster · Muon optimizer',
    )
    expect(label('a MOSS-Image LoRA now takes about 20 minutes instead of 49.', '20')).toBe(
      'MOSS-Image LoRA · was 49 min',
    )
    expect(
      label('Training a MOSS-Image LoRA now takes about 20 minutes instead of 49.', '20'),
    ).toBe('MOSS-Image LoRA training · was 49 min')
  })
})

describe('keyPointText chunk edges', () => {
  it('states the sentence a shot cuts into, never the cut-off words', () => {
    expect(
      keyPointText({
        text: 'the baseline for major mailbox',
        context: 'DMARC at p=none is now the baseline for major mailbox providers.',
      }),
    ).toBe('DMARC at p=none is the baseline')
  })
})
