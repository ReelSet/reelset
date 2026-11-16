import { z } from 'zod'
import type { Source } from '../db/enums'
import { claudeRateCard, type ClaudeEffort, type ClaudeModel } from './claude-model'
import { SUPERSEDED_GATE_INSTRUCTIONS } from './gate-legacy'
import { sha256Hex } from './hash'
import { SOURCES } from './source'

export const GATE_PROMPT_VERSION = 'gate-v3'
export const GATE_SETTING_KEY_PREFIX = 'gate_'

export const GATE_MODES = ['off', 'shadow', 'live'] as const
export const gateModeSchema = z.enum(GATE_MODES)
export type GateMode = z.infer<typeof gateModeSchema>
export type GateDecisionMode = Exclude<GateMode, 'off'>

export const GATE_VERDICTS = ['reel', 'source_only'] as const
export const gateVerdictSchema = z.enum(GATE_VERDICTS)
export type GateVerdict = z.infer<typeof gateVerdictSchema>

export const GATE_DECIDERS = ['rule', 'model', 'explore', 'admin'] as const
export type GateDecidedBy = (typeof GATE_DECIDERS)[number]

/** How a judgement came about: `auto` rows belong to the pipeline (admin overrides included), `manual` rows are on-demand analysis that never acts on the item. */
export const GATE_TRIGGERS = ['auto', 'manual'] as const
export type GateTrigger = (typeof GATE_TRIGGERS)[number]

export const GATE_LABELS = ['agree', 'disagree'] as const
export type GateLabel = (typeof GATE_LABELS)[number]

export const GATE_SIGNAL_MAX = 10
export const GATE_WEIGHT_MAX = 10
export const GATE_SCORE_MAX = 100

/** The six sub-marks of gate-v1. Since gate-v2 the judge gives one holistic score, so new rows store no signals; these stay to read and display old rows. */
export const GATE_SIGNALS = [
  {
    key: 'hook',
    label: 'Hook',
    description: 'Is there a surprising, concrete fact a hook can be built on',
  },
  {
    key: 'visual',
    label: 'Visuals',
    description: 'Are there screenshots, a demo, images or footage to show',
  },
  {
    key: 'novelty',
    label: 'Novelty',
    description: 'Is this new, or a rehash of something already widely covered',
  },
  {
    key: 'audience',
    label: 'Audience fit',
    description: 'Does it fit aspirational developers and a general US audience curious about AI',
  },
  {
    key: 'clarity',
    label: 'Clarity',
    description: 'Can it be explained in 40 seconds in plain words',
  },
  {
    key: 'stakes',
    label: 'Stakes',
    description: 'Does it change what a viewer can do, save or lose',
  },
] as const

export type GateSignalKey = (typeof GATE_SIGNALS)[number]['key']
export const GATE_SIGNAL_KEYS = GATE_SIGNALS.map((signal) => signal.key) as [
  GateSignalKey,
  ...GateSignalKey[],
]

/** Per-signal marks from the judge, 0 to 10; a signal the judge did not mark is absent. */
export type GateSignals = Partial<Record<GateSignalKey, number>>

/** Legacy (gate-v1): weights no longer affect a verdict. The setting is still parsed so stored values and old tooling keep working. */
export const DEFAULT_GATE_WEIGHTS: Record<GateSignalKey, number> = {
  hook: 3,
  visual: 2,
  novelty: 2,
  audience: 2,
  clarity: 1,
  stakes: 2,
}

function shapeOf<K extends string, S extends z.ZodType>(
  keys: readonly K[],
  build: (key: K) => S,
): Record<K, S> {
  return Object.fromEntries(keys.map((key) => [key, build(key)])) as Record<K, S>
}

// Per-key defaults so a stored value written before a signal or source existed still parses.
export const gateWeightsSchema = z
  .object(
    shapeOf(GATE_SIGNAL_KEYS, (key) =>
      z.number().min(0).max(GATE_WEIGHT_MAX).default(DEFAULT_GATE_WEIGHTS[key]),
    ),
  )
  .refine((weights) => Object.values(weights).some((weight) => weight > 0), {
    message: 'At least one signal needs a weight above 0',
  })
export type GateWeights = z.infer<typeof gateWeightsSchema>

export const GATE_SOURCE_RULE_MODES = ['judge', 'always_reel', 'always_source_only'] as const
export type GateSourceRuleMode = (typeof GATE_SOURCE_RULE_MODES)[number]

export const gateSourceRuleSchema = z.object({
  mode: z.enum(GATE_SOURCE_RULE_MODES).default('judge'),
  threshold: z.number().min(0).max(GATE_SCORE_MAX).optional(),
  minItemScore: z.number().min(0).max(1).optional(),
})
export type GateSourceRule = z.infer<typeof gateSourceRuleSchema>

export const gateSourceRulesSchema = z.object(
  shapeOf(SOURCES, () => gateSourceRuleSchema.default({ mode: 'judge' })),
)
export type GateSourceRules = z.infer<typeof gateSourceRulesSchema>

export const DEFAULT_GATE_SOURCE_RULES: GateSourceRules = gateSourceRulesSchema.parse({})

export const GATE_INSTRUCTIONS_MIN_CHARS = 100
export const GATE_INSTRUCTIONS_MAX_CHARS = 8000

export type GateConfig = {
  mode: GateMode
  threshold: number
  weights: GateWeights
  sourceRules: GateSourceRules
  instructions: string
  model: ClaudeModel
  effort: ClaudeEffort
  exploreRate: number
  exampleCount: number
  /** How many real Instagram results (winners and losers) the judge is shown; 0 turns them off. */
  performanceExamples: number
  maxCostUsdPerItem: number
}

export const GATE_LABEL_REASONS = [
  { key: 'actually_interesting', label: 'Actually interesting', shouldBe: 'reel' },
  { key: 'strong_visuals_missed', label: 'Strong visuals missed', shouldBe: 'reel' },
  { key: 'funny_or_timely', label: 'Funny or timely', shouldBe: 'reel' },
  { key: 'big_name_or_drama', label: 'Big name or drama', shouldBe: 'reel' },
  { key: 'too_niche', label: 'Too niche', shouldBe: 'source_only' },
  { key: 'nobody_would_care', label: 'Nobody would care', shouldBe: 'source_only' },
  { key: 'rehash', label: 'Rehash, nothing new', shouldBe: 'source_only' },
  { key: 'nothing_to_show', label: 'Nothing to show', shouldBe: 'source_only' },
  { key: 'too_hard_to_explain', label: 'Too hard to explain', shouldBe: 'source_only' },
  { key: 'clickbait_low_trust', label: 'Clickbait or low trust', shouldBe: 'source_only' },
  { key: 'other', label: 'Other', shouldBe: null },
] as const satisfies readonly { key: string; label: string; shouldBe: GateVerdict | null }[]

export type GateLabelReason = (typeof GATE_LABEL_REASONS)[number]['key']
export const GATE_LABEL_REASON_KEYS = GATE_LABEL_REASONS.map((reason) => reason.key) as [
  GateLabelReason,
  ...GateLabelReason[],
]
export const gateLabelReasonSchema = z.enum(GATE_LABEL_REASON_KEYS)

export const DEFAULT_GATE_INSTRUCTIONS = `You rate how well a source would do as a short vertical video (a reel) on Instagram, told as a story by a narrator in 40 to 85 seconds.

The one question: if a reel were made from this, how likely is a normal US Instagram viewer, or a developer scrolling their feed, to stop, watch to the end, and like, save or share it? Rate interest and story. Do not rate truth, usefulness or how serious the source is.

Who is scrolling: people curious about tech and AI, and developers. They know the big names, enjoy the drama and get the jokes. Most do not write code every day.

Reels that hold people are stories, not summaries. Before you rate, answer five questions:
1. The surprise: can you say in one plain sentence what is surprising here, so a curious viewer gets it? ("Nvidia's own staff want the fired CEO back.") A tip about an AI tool passes when anyone who uses that tool would get it.
2. The stake: does it touch the viewer's own life (their phone, laptop, money, job, privacy, safety, the future of AI) or people and companies they know?
3. The story: is there a story inside it? A fight between people or companies, an experiment with a strange result, a before and after, a mystery with a cause, a rise or a fall, a twist. A how-to or a tip counts when it has a before and after (what it costs or hurts now, what changes once you do it). A list of features, a changelog or a spec sheet is not a story.
4. The material: does the text hold enough to tell it (what happened, who, the numbers, why it matters), or is it only a headline or a one-line post with nothing behind it?
5. The trust: is it a real source rather than spam, an ad, or a lure?

Rate HIGH (70 and up) when the answers are mostly yes, especially with:
- Famous people or companies in tech: Jensen Huang, Sam Altman, Elon Musk, Nvidia, OpenAI, Apple, Google, Meta, Anthropic and the like.
- Drama: feuds, gossip, call-outs, lawsuits, firings, revolts.
- Memes and jokes that are funny or timely.
- Surprising numbers, records, "X beats Y", experiments with a strange result.
- Big launches, things going free or getting expensive, layoffs, outages, hacks and leaks.
- Hidden things in everyday tech: why a device or app secretly works the way it does.
- Demos that look like magic, relatable tech pain, opinions people will argue about.
- Practical tricks for the AI tools people use every day (ChatGPT, Claude, Fable, Gemini, Cursor, Copilot): a hidden limit, a free workaround, a setting that saves money or time. This audience uses them daily, so these are not niche.

Entertainment counts as much as usefulness: a meme, a rumour or a heated thread is a fine reel when it is funny, timely or about someone people know. Being unverified, opinion-based or only a discussion thread is NOT a reason for a low rating: the script says where a claim comes from ("A Reddit post says...").

Hard ceilings, whatever else is true:
- No surprise you can say in one plain sentence, or it needs specialist background to follow: at most 35. People who use ChatGPT, Claude, Fable or Cursor every day are this audience, not specialists.
- The text is only a headline or a link with nothing to tell: at most 40. Breaking news about a big name or company is the exception: a headline that states the event ("X resigns", "Y buys Z", "Z is down") already says what happened, so a short source or a thread of reactions is enough material.
- Only one small group of specialists would care (an obscure library, a niche protocol, an incremental paper, a hobby radio feed): at most 30.
- A lure or low trust: an unknown account using a big brand's name, a repo or post that pushes a download from a file host, spam, an ad or plain self-promotion: at most 15.

Rate LOW when it is a routine changelog or version bump, an availability or status report, a job post, a link dump, an essay or opinion with no event behind it, or old news repeated with nothing new.

Engagement on the source (points, comments, stars) is a hint that people already care. A big name does not rescue a boring item, and an unknown name does not sink a striking story.

Use the whole scale: 80 and up for a reel you expect to do very well, around 50 for an average one, 20 and below for something almost nobody would watch.`

const sameText = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** True when stored instructions are just an untouched copy of an older default, which would otherwise mask the current one. */
export function isSupersededGateInstructions(instructions: string): boolean {
  return SUPERSEDED_GATE_INSTRUCTIONS.some((old) => sameText(old, instructions))
}

/** The instructions to judge with: the stored text, unless it is an untouched older default. */
export function currentGateInstructions(stored: string): string {
  return isSupersededGateInstructions(stored) ? DEFAULT_GATE_INSTRUCTIONS : stored
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Keeps the known signals that carry a finite number, clamped to 0..10; anything else is dropped. */
export function parseGateSignals(raw: unknown): GateSignals {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const signals: GateSignals = {}
  for (const key of GATE_SIGNAL_KEYS) {
    const value = record[key]
    if (isFiniteNumber(value)) signals[key] = clamp(value, 0, GATE_SIGNAL_MAX)
  }
  return signals
}

/** Weighted average of the marked signals on a 0..100 scale; unmarked signals are left out, and no usable weight scores 0. */
export function gateScore(signals: GateSignals, weights: Partial<GateWeights>): number {
  let weighted = 0
  let totalWeight = 0
  for (const key of GATE_SIGNAL_KEYS) {
    const signal = signals[key]
    const weight = weights[key]
    if (!isFiniteNumber(signal) || !isFiniteNumber(weight) || weight <= 0) continue
    weighted += clamp(signal, 0, GATE_SIGNAL_MAX) * weight
    totalWeight += weight
  }
  if (totalWeight === 0) return 0
  const score = (weighted / (totalWeight * GATE_SIGNAL_MAX)) * GATE_SCORE_MAX
  return Math.round(score * 100) / 100
}

/** A score at or above the threshold is a reel; a score that is not a number is never a reel. */
export function gateVerdict(score: number, threshold: number): GateVerdict {
  return score >= threshold ? 'reel' : 'source_only'
}

export function oppositeGateVerdict(verdict: GateVerdict): GateVerdict {
  return verdict === 'reel' ? 'source_only' : 'reel'
}

/** What the admin says the answer should have been: the verdict when agreed, its opposite when not. */
export function correctGateVerdict(verdict: GateVerdict, label: GateLabel): GateVerdict {
  return label === 'agree' ? verdict : oppositeGateVerdict(verdict)
}

/** What the judge itself concluded: an explore row stores `reel` although the judge said source only. */
export function judgeVerdict(decision: { verdict: GateVerdict; decidedBy: string }): GateVerdict {
  return decision.decidedBy === 'explore' ? oppositeGateVerdict(decision.verdict) : decision.verdict
}

/**
 * Whether the newest automatic decision clears an item for Instagram auto posting; mirrors
 * PASSES_GATE_SQL in instagram-post.repo. A label wins, and an unlabelled explore row never passes.
 */
export function passesGateForAutoPost(decision: {
  verdict: GateVerdict
  decidedBy: string
  label: GateLabel | null
}): boolean {
  if (decision.label) return correctGateVerdict(decision.verdict, decision.label) === 'reel'
  return decision.decidedBy !== 'explore' && decision.verdict === 'reel'
}

/** Whether an admin's review says the judge's own verdict was right; labels are about the stored outcome, so explore rows invert. */
export function judgeWasRight(decision: {
  verdict: GateVerdict
  decidedBy: string
  label: GateLabel
}): boolean {
  return correctGateVerdict(decision.verdict, decision.label) === judgeVerdict(decision)
}

export const GATE_CHARS_PER_TOKEN = 4
export const GATE_EXPECTED_OUTPUT_TOKENS = 500
export const GATE_EVIDENCE_MIN_CHARS = 600
export const GATE_EVIDENCE_MAX_CHARS = 6000
/** Rough size of the judge prompt around the instructions and the evidence: frame, item header and a full set of examples. */
export const GATE_PROMPT_OVERHEAD_CHARS = 4000

const TOKENS_PER_PRICE_UNIT = 1_000_000

// Input is priced at the dearer of plain and cache-write rates, since the system half may be cached.
function gateRates(model: ClaudeModel): { inputUsdPerChar: number; outputUsd: number } {
  const rates = claudeRateCard(model, 0)
  const inputRate = Math.max(rates.input, rates.cacheWrite)
  return {
    inputUsdPerChar: inputRate / TOKENS_PER_PRICE_UNIT / GATE_CHARS_PER_TOKEN,
    outputUsd: (GATE_EXPECTED_OUTPUT_TOKENS * rates.output) / TOKENS_PER_PRICE_UNIT,
  }
}

/** Estimated list-price cost of one judge call with a prompt of this many characters and a typical answer. */
export function gateCallCostUsd(model: ClaudeModel, promptChars: number): number {
  const { inputUsdPerChar, outputUsd } = gateRates(model)
  return Math.max(0, promptChars) * inputUsdPerChar + outputUsd
}

export type GateCallBudget = {
  /** False when even a call with the smallest evidence excerpt costs more than the cap. */
  fits: boolean
  /** Evidence characters one call may carry under the cap; 0 when it does not fit. */
  evidenceChars: number
  /** Estimated cost of the smallest possible call. */
  minCostUsd: number
}

/** Whether one judge call fits under a per-item cost cap at this model's price, and how much evidence it may carry. `fixedPromptChars` is everything in the prompt but the evidence (for a settings page: instructions length plus GATE_PROMPT_OVERHEAD_CHARS). */
export function gateCallBudget(input: {
  model: ClaudeModel
  maxCostUsd: number
  fixedPromptChars: number
}): GateCallBudget {
  const { inputUsdPerChar } = gateRates(input.model)
  const minCostUsd = gateCallCostUsd(input.model, input.fixedPromptChars + GATE_EVIDENCE_MIN_CHARS)
  if (!(minCostUsd <= input.maxCostUsd)) return { fits: false, evidenceChars: 0, minCostUsd }
  const spare = Math.floor((input.maxCostUsd - minCostUsd) / inputUsdPerChar)
  const evidenceChars = Math.min(GATE_EVIDENCE_MAX_CHARS, GATE_EVIDENCE_MIN_CHARS + spare)
  return { fits: true, evidenceChars, minCostUsd }
}

export const GATE_RULES = ['always_reel', 'always_source_only', 'below_min_item_score'] as const
export type GateRuleName = (typeof GATE_RULES)[number]

export type GateRuleOutcome =
  | { kind: 'verdict'; verdict: GateVerdict; rule: GateRuleName; threshold: number }
  | { kind: 'judge'; threshold: number }

/** Settles an item by its source's rule without the model, or says to ask the model with the threshold that applies. */
export function applySourceRule(
  source: Source,
  itemScore: number,
  config: Pick<GateConfig, 'threshold' | 'sourceRules'>,
): GateRuleOutcome {
  const rule: GateSourceRule = config.sourceRules[source] ?? { mode: 'judge' }
  const threshold = rule.threshold ?? config.threshold
  if (rule.mode === 'always_reel') {
    return { kind: 'verdict', verdict: 'reel', rule: 'always_reel', threshold }
  }
  if (rule.mode === 'always_source_only') {
    return { kind: 'verdict', verdict: 'source_only', rule: 'always_source_only', threshold }
  }
  if (rule.minItemScore !== undefined && itemScore < rule.minItemScore) {
    return { kind: 'verdict', verdict: 'source_only', rule: 'below_min_item_score', threshold }
  }
  return { kind: 'judge', threshold }
}

const EXPLORE_SALT = 'gate-explore:'
const UINT32_RANGE = 2 ** 32

// FNV-1a with a murmur3 finalizer: synchronous, and spreads near-identical ids evenly over 32 bits.
function hash32(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/** Whether this item is in the explore sample; fixed per item id, so a retry answers the same and raising the rate only adds items. */
export function shouldExplore(itemId: string, exploreRate: number): boolean {
  if (!Number.isFinite(exploreRate) || exploreRate <= 0) return false
  return hash32(EXPLORE_SALT + itemId) / UINT32_RANGE < exploreRate
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null'
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

const GATE_CONFIG_HASH_CHARS = 12

/** Short fingerprint of every setting that can change a verdict; `mode` is left out so shadow and live runs of the same settings match, and so are the legacy `weights`, which no longer change anything. */
export async function gateConfigHash(config: GateConfig): Promise<string> {
  const { mode: _mode, weights: _weights, ...judged } = config
  const digest = await sha256Hex(canonicalJson(judged))
  return digest.slice(0, GATE_CONFIG_HASH_CHARS)
}
