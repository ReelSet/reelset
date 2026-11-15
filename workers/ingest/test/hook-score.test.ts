import { describe, expect, it } from 'vitest'
import { HOOK_FORMULAS } from '../src/pipeline/hook-formulas'
import {
  MAX_HOOK_CHARS,
  hookAdvice,
  pickHook,
  readHookOptions,
  scoreHook,
} from '../src/pipeline/hook-score'

describe('scoreHook', () => {
  it('scores a concrete, front-loaded hook well above a greeting or a preamble', () => {
    const strong = scoreHook("You don't need a GPU to run this model.")
    const greeting = scoreHook('Hey guys, today I wanted to talk about a new tool')
    const preamble = scoreHook('In this video we look at how a framework works.')
    expect(strong.score).toBeGreaterThanOrEqual(70)
    expect(greeting.score).toBeLessThan(35)
    expect(preamble.score).toBeLessThan(35)
    expect(greeting.flags).toContain('greeting')
    expect(preamble.flags.join(' ')).toContain('preamble')
  })

  it('counts acronyms, product names and spoken numbers as concrete', () => {
    expect(
      scoreHook('One DNS record stops your email bouncing.').checks.specificity,
    ).toBeGreaterThan(15)
    expect(scoreHook('Ollama now runs this without a GPU.').checks.specificity).toBeGreaterThan(15)
    expect(scoreHook('It took three days instead of a month.').checks.specificity).toBeGreaterThan(
      15,
    )
    expect(scoreHook('This is a tool that helps people.').checks.specificity).toBe(15)
  })

  it('penalises a hook that runs past the spoken window', () => {
    const long = scoreHook(
      'This brand new open source framework lets developers everywhere build agents much faster than before.',
    )
    expect(long.checks.length).toBeLessThan(60)
    expect(long.weakest).toBe('length')
    expect(hookAdvice(long)).toContain(`${MAX_HOOK_CHARS} characters`)
  })

  it('names the weakest property so a rewrite knows what to fix', () => {
    const vague = scoreHook('This is something really interesting for everyone.')
    expect(['specificity', 'stakes', 'frontload']).toContain(vague.weakest)
    expect(vague.score).toBeLessThan(50)
  })

  it('estimates how long the hook takes to say', () => {
    expect(scoreHook('Training took 49 minutes. Now it takes 20.').seconds).toBeCloseTo(2.9, 0)
  })

  it('rates every formula example as a usable hook', () => {
    for (const f of HOOK_FORMULAS) {
      const r = scoreHook(f.example)
      expect(r.score, `${f.name}: ${f.example}`).toBeGreaterThanOrEqual(50)
      expect(f.example.length, f.name).toBeLessThanOrEqual(MAX_HOOK_CHARS)
    }
  })
})

describe('pickHook', () => {
  it('keeps the strongest option and its headline', () => {
    const pick = pickHook([
      { formula: 'The Reveal', spoken: 'This is a new tool for developers.', headline: 'NEW TOOL' },
      {
        formula: 'Time Collapse',
        spoken: 'Training took 49 minutes. Now it takes 20.',
        headline: '49 MIN -> 20 MIN',
      },
      { formula: 'Permission', spoken: 'Let us talk about training speed today.' },
    ])
    expect(pick?.option.formula).toBe('Time Collapse')
    expect(pick?.option.headline).toBe('49 MIN -> 20 MIN')
    expect(pick?.index).toBe(1)
  })

  it('keeps a decent favourite even when another option scores higher', () => {
    const options = [
      { formula: 'The Statistic', spoken: 'Ten people, one Mac. The tenth waits 7 minutes.' },
      { formula: 'Nobody Tells You', spoken: 'Nobody tells you the tenth user waits 7 minutes.' },
    ]
    expect(pickHook(options)?.index).toBe(0)
    expect(pickHook(options, new Set(), options[1]!.spoken)?.index).toBe(1)
  })

  it('swaps out a favourite with a dealbreaker', () => {
    const pick = pickHook(
      [
        { spoken: 'In this video, a GPU beats 3 others by 20 percent.' },
        { spoken: 'One $600 GPU just beat 3 pricier ones.' },
      ],
      new Set(),
    )
    expect(pick?.index).toBe(1)
  })

  it('returns null when there is nothing to pick', () => {
    expect(pickHook([])).toBeNull()
  })
})

describe('readHookOptions', () => {
  it('drops malformed entries and trims the rest', () => {
    expect(
      readHookOptions([
        { formula: ' Permission ', spoken: ' You do not need it. ', headline: 'NO NEED' },
        { spoken: '' },
        'nope',
        { formula: 'x' },
      ]),
    ).toEqual([{ formula: 'Permission', spoken: 'You do not need it.', headline: 'NO NEED' }])
    expect(readHookOptions(undefined)).toEqual([])
  })
})
