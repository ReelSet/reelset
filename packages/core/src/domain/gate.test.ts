import { describe, expect, it } from 'vitest'
import { DEFAULT_CLAUDE_MODEL } from './claude-model'
import {
  DEFAULT_GATE_INSTRUCTIONS,
  DEFAULT_GATE_SOURCE_RULES,
  DEFAULT_GATE_WEIGHTS,
  GATE_INSTRUCTIONS_MAX_CHARS,
  GATE_INSTRUCTIONS_MIN_CHARS,
  GATE_LABEL_REASONS,
  GATE_PROMPT_VERSION,
  GATE_SIGNALS,
  GATE_SIGNAL_KEYS,
  applySourceRule,
  correctGateVerdict,
  gateConfigHash,
  gateScore,
  gateSourceRulesSchema,
  gateVerdict,
  gateWeightsSchema,
  oppositeGateVerdict,
  parseGateSignals,
  passesGateForAutoPost,
  shouldExplore,
  type GateConfig,
  type GateSignals,
} from './gate'
import { SOURCES } from './source'

const EVEN_WEIGHTS = { hook: 1, visual: 1, novelty: 1, audience: 1, clarity: 1, stakes: 1 }
const ALL_TENS: GateSignals = {
  hook: 10,
  visual: 10,
  novelty: 10,
  audience: 10,
  clarity: 10,
  stakes: 10,
}

const config = (over: Partial<GateConfig> = {}): GateConfig => ({
  mode: 'shadow',
  threshold: 55,
  weights: DEFAULT_GATE_WEIGHTS,
  sourceRules: DEFAULT_GATE_SOURCE_RULES,
  instructions: DEFAULT_GATE_INSTRUCTIONS,
  model: DEFAULT_CLAUDE_MODEL,
  effort: 'low',
  exploreRate: 0.05,
  exampleCount: 8,
  performanceExamples: 8,
  maxCostUsdPerItem: 0.01,
  ...over,
})

describe('gate constants', () => {
  it('lists the six signals with a label and a description each', () => {
    expect(GATE_SIGNAL_KEYS).toEqual(['hook', 'visual', 'novelty', 'audience', 'clarity', 'stakes'])
    for (const signal of GATE_SIGNALS) {
      expect(signal.label.length).toBeGreaterThan(0)
      expect(signal.description.length).toBeGreaterThan(10)
    }
  })

  it('gives every signal a default weight and every source a judge rule', () => {
    expect(Object.keys(DEFAULT_GATE_WEIGHTS).sort()).toEqual([...GATE_SIGNAL_KEYS].sort())
    expect(Object.keys(DEFAULT_GATE_SOURCE_RULES).sort()).toEqual([...SOURCES].sort())
    for (const source of SOURCES) {
      expect(DEFAULT_GATE_SOURCE_RULES[source]).toEqual({ mode: 'judge' })
    }
  })

  it('offers disagreement reasons for both directions, with unique keys and a catch-all', () => {
    const keys = GATE_LABEL_REASONS.map((reason) => reason.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(GATE_LABEL_REASONS.some((reason) => reason.shouldBe === 'reel')).toBe(true)
    expect(GATE_LABEL_REASONS.some((reason) => reason.shouldBe === 'source_only')).toBe(true)
    expect(GATE_LABEL_REASONS.at(-1)).toMatchObject({ key: 'other', shouldBe: null })
  })

  it('ships default instructions inside the editable bounds and a fixed prompt version', () => {
    expect(GATE_PROMPT_VERSION).toBe('gate-v2')
    expect(DEFAULT_GATE_INSTRUCTIONS.length).toBeGreaterThan(GATE_INSTRUCTIONS_MIN_CHARS)
    expect(DEFAULT_GATE_INSTRUCTIONS.length).toBeLessThan(GATE_INSTRUCTIONS_MAX_CHARS)
  })
})

describe('parseGateSignals', () => {
  it('keeps known signals, clamps them to 0..10 and drops everything else', () => {
    expect(
      parseGateSignals({ hook: 7, visual: 14, novelty: -2, clarity: '9', stakes: NaN, extra: 3 }),
    ).toEqual({ hook: 7, visual: 10, novelty: 0 })
  })

  it('returns no signals for anything that is not an object', () => {
    for (const raw of [null, undefined, 'hook', 7, []]) expect(parseGateSignals(raw)).toEqual({})
  })
})

describe('gateScore', () => {
  it('scales the weighted average to 0..100', () => {
    expect(gateScore(ALL_TENS, EVEN_WEIGHTS)).toBe(100)
    expect(gateScore({ ...ALL_TENS, hook: 0, visual: 0, novelty: 0 }, EVEN_WEIGHTS)).toBe(50)
    expect(gateScore({}, EVEN_WEIGHTS)).toBe(0)
  })

  it('lets a heavier signal pull the score its way', () => {
    const signals = { hook: 10, visual: 0 }
    expect(gateScore(signals, { hook: 3, visual: 1 })).toBe(75)
    expect(gateScore(signals, { hook: 1, visual: 3 })).toBe(25)
  })

  it('averages only the signals the judge marked', () => {
    expect(gateScore({ hook: 8 }, EVEN_WEIGHTS)).toBe(80)
    expect(gateScore({ hook: 8, visual: Number.NaN }, EVEN_WEIGHTS)).toBe(80)
  })

  it('ignores signals whose weight is zero, missing or negative', () => {
    expect(gateScore({ hook: 10, visual: 0 }, { hook: 2, visual: 0 })).toBe(100)
    expect(gateScore({ hook: 10, visual: 0 }, { hook: 2 })).toBe(100)
    expect(gateScore({ hook: 10, visual: 0 }, { hook: 2, visual: -5 })).toBe(100)
  })

  it('scores 0 instead of NaN when no weight is usable', () => {
    const noWeight = { hook: 0, visual: 0, novelty: 0, audience: 0, clarity: 0, stakes: 0 }
    expect(gateScore(ALL_TENS, noWeight)).toBe(0)
    expect(gateScore(ALL_TENS, {})).toBe(0)
  })

  it('clamps out-of-range signals and rounds to two decimals', () => {
    expect(gateScore({ hook: 25, visual: -4 }, { hook: 1, visual: 1 })).toBe(50)
    expect(gateScore({ hook: 1, visual: 0, novelty: 0 }, { hook: 1, visual: 1, novelty: 1 })).toBe(
      3.33,
    )
  })
})

describe('gateVerdict', () => {
  it('makes a reel at or above the threshold and source only below it', () => {
    expect(gateVerdict(55, 55)).toBe('reel')
    expect(gateVerdict(80, 55)).toBe('reel')
    expect(gateVerdict(54.99, 55)).toBe('source_only')
  })

  it('never makes a reel from a score that is not a number', () => {
    expect(gateVerdict(Number.NaN, 0)).toBe('source_only')
  })
})

describe('correctGateVerdict', () => {
  it('is the verdict when the admin agreed and its opposite when not', () => {
    expect(correctGateVerdict('reel', 'agree')).toBe('reel')
    expect(correctGateVerdict('reel', 'disagree')).toBe('source_only')
    expect(correctGateVerdict('source_only', 'agree')).toBe('source_only')
    expect(correctGateVerdict('source_only', 'disagree')).toBe('reel')
    expect(oppositeGateVerdict('reel')).toBe('source_only')
    expect(oppositeGateVerdict('source_only')).toBe('reel')
  })
})

describe('passesGateForAutoPost', () => {
  const pass = (
    verdict: 'reel' | 'source_only',
    decidedBy: string,
    label: 'agree' | 'disagree' | null,
  ) => passesGateForAutoPost({ verdict, decidedBy, label })

  it('passes an unlabelled reel verdict from a rule or the model', () => {
    expect(pass('reel', 'model', null)).toBe(true)
    expect(pass('reel', 'rule', null)).toBe(true)
    expect(pass('source_only', 'model', null)).toBe(false)
  })

  it('never passes an unlabelled explore row, the judge said no to it', () => {
    expect(pass('reel', 'explore', null)).toBe(false)
  })

  it('lets the admin label win', () => {
    expect(pass('source_only', 'model', 'disagree')).toBe(true)
    expect(pass('reel', 'model', 'disagree')).toBe(false)
    expect(pass('reel', 'explore', 'agree')).toBe(true)
    expect(pass('reel', 'explore', 'disagree')).toBe(false)
  })
})

describe('applySourceRule', () => {
  const rules = (rule: object) =>
    config({ sourceRules: { ...DEFAULT_GATE_SOURCE_RULES, ...gateSourceRulesSchema.parse(rule) } })

  it('asks the model with the global threshold by default', () => {
    for (const source of SOURCES) {
      expect(applySourceRule(source, 0.5, config())).toEqual({ kind: 'judge', threshold: 55 })
    }
  })

  it('uses a source threshold override only for that source', () => {
    const overridden = rules({ papers: { mode: 'judge', threshold: 70 } })
    expect(applySourceRule('papers', 0.5, overridden)).toEqual({ kind: 'judge', threshold: 70 })
    expect(applySourceRule('hn', 0.5, overridden)).toEqual({ kind: 'judge', threshold: 55 })
  })

  it('settles always_reel and always_source_only without the model, naming the rule', () => {
    const fixed = rules({
      youtube: { mode: 'always_reel' },
      news: { mode: 'always_source_only', threshold: 40 },
    })
    expect(applySourceRule('youtube', 0, fixed)).toEqual({
      kind: 'verdict',
      verdict: 'reel',
      rule: 'always_reel',
      threshold: 55,
    })
    expect(applySourceRule('news', 1, fixed)).toEqual({
      kind: 'verdict',
      verdict: 'source_only',
      rule: 'always_source_only',
      threshold: 40,
    })
  })

  it('sends items below the source minimum item score to source only, and judges the rest', () => {
    const floor = rules({ reddit: { mode: 'judge', minItemScore: 0.6 } })
    expect(applySourceRule('reddit', 0.59, floor)).toEqual({
      kind: 'verdict',
      verdict: 'source_only',
      rule: 'below_min_item_score',
      threshold: 55,
    })
    expect(applySourceRule('reddit', 0.6, floor)).toEqual({ kind: 'judge', threshold: 55 })
  })

  it('lets always_reel win over a minimum item score', () => {
    const both = rules({ github: { mode: 'always_reel', minItemScore: 0.9 } })
    expect(applySourceRule('github', 0.1, both)).toMatchObject({ verdict: 'reel' })
  })

  it('judges a source that has no stored rule', () => {
    const partial = config({ sourceRules: {} as GateConfig['sourceRules'] })
    expect(applySourceRule('hn', 0.5, partial)).toEqual({ kind: 'judge', threshold: 55 })
  })
})

describe('shouldExplore', () => {
  const ids = Array.from(
    { length: 20_000 },
    (_, n) => `0b5d2f3e-6a1c-4e0b-9a55-${n.toString(16).padStart(12, '0')}`,
  )

  it('gives the same answer for the same item every time', () => {
    for (const id of ids.slice(0, 200)) {
      expect(shouldExplore(id, 0.3)).toBe(shouldExplore(id, 0.3))
    }
  })

  it('samples close to the requested rate, even over near-identical ids', () => {
    const picked = ids.filter((id) => shouldExplore(id, 0.05)).length
    expect(picked / ids.length).toBeGreaterThan(0.04)
    expect(picked / ids.length).toBeLessThan(0.06)
  })

  it('only adds items when the rate goes up', () => {
    for (const id of ids.slice(0, 2000)) {
      if (shouldExplore(id, 0.05)) expect(shouldExplore(id, 0.2)).toBe(true)
    }
  })

  it('never explores at rate 0 or a bad rate, and always at rate 1', () => {
    for (const id of ids.slice(0, 200)) {
      expect(shouldExplore(id, 0)).toBe(false)
      expect(shouldExplore(id, -1)).toBe(false)
      expect(shouldExplore(id, Number.NaN)).toBe(false)
      expect(shouldExplore(id, 1)).toBe(true)
    }
  })
})

describe('gateConfigHash', () => {
  it('is short, hex and stable across key order', async () => {
    const base = config()
    const reordered = config({
      weights: Object.fromEntries(Object.entries(base.weights).reverse()) as GateConfig['weights'],
      sourceRules: Object.fromEntries(
        Object.entries(base.sourceRules).reverse(),
      ) as GateConfig['sourceRules'],
    })
    const hash = await gateConfigHash(base)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
    expect(await gateConfigHash(reordered)).toBe(hash)
  })

  it('changes when any setting that can change a verdict changes', async () => {
    const hash = await gateConfigHash(config())
    const changes: Partial<GateConfig>[] = [
      { threshold: 60 },
      { sourceRules: { ...DEFAULT_GATE_SOURCE_RULES, hn: { mode: 'always_reel' } } },
      { instructions: `${DEFAULT_GATE_INSTRUCTIONS} More.` },
      { model: 'claude-sonnet-5-5' },
      { effort: 'high' },
      { exploreRate: 0.1 },
      { exampleCount: 4 },
      { performanceExamples: 0 },
      { maxCostUsdPerItem: 0.02 },
    ]
    for (const change of changes) expect(await gateConfigHash(config(change))).not.toBe(hash)
  })

  it('ignores the mode, so shadow and live runs of the same settings share a hash', async () => {
    expect(await gateConfigHash(config({ mode: 'live' }))).toBe(await gateConfigHash(config()))
  })

  it('treats an unset optional rule field the same as a missing one', async () => {
    const explicit = config({
      sourceRules: { ...DEFAULT_GATE_SOURCE_RULES, hn: { mode: 'judge', threshold: undefined } },
    })
    expect(await gateConfigHash(explicit)).toBe(await gateConfigHash(config()))
  })
})

describe('gate schemas', () => {
  it('fills weights and source rules that a stored value is missing', () => {
    expect(gateWeightsSchema.parse({ hook: 9 })).toEqual({ ...DEFAULT_GATE_WEIGHTS, hook: 9 })
    expect(gateSourceRulesSchema.parse({ hn: { mode: 'always_reel' } })).toEqual({
      ...DEFAULT_GATE_SOURCE_RULES,
      hn: { mode: 'always_reel' },
    })
  })

  it('rejects out-of-range weights, all-zero weights and unknown rule modes', () => {
    expect(gateWeightsSchema.safeParse({ hook: 11 }).success).toBe(false)
    expect(gateWeightsSchema.safeParse({ hook: -1 }).success).toBe(false)
    const zero = { hook: 0, visual: 0, novelty: 0, audience: 0, clarity: 0, stakes: 0 }
    expect(gateWeightsSchema.safeParse(zero).success).toBe(false)
    expect(gateSourceRulesSchema.safeParse({ hn: { mode: 'never' } }).success).toBe(false)
    expect(gateSourceRulesSchema.safeParse({ hn: { threshold: 101 } }).success).toBe(false)
    expect(gateSourceRulesSchema.safeParse({ hn: { minItemScore: 1.5 } }).success).toBe(false)
  })
})
