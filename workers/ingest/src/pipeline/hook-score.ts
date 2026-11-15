// Hook scorer ported from github.com/Jakeschincariol/instagram-agent-skill
// (skills/ig-reel/hookscore.py, MIT, (c) Jake Schincariol) and re-tuned for tech narration:
// product names and acronyms count as concrete, and ADDRESS carries little weight because the
// original's own test found it did not separate hits from misses. It catches weak hooks; it does
// not predict views.

import { AURA_CHARS_PER_SECOND, spokenChars } from '@reelset/core'
import { isName } from './text-rules'

export type HookCheck = 'length' | 'specificity' | 'stakes' | 'frontload' | 'address'

export type HookScore = {
  score: number
  checks: Record<HookCheck, number>
  weakest: HookCheck
  flags: string[]
  seconds: number
}

export type HookOption = { formula?: string; spoken: string; headline?: string }

export type HookPick = { option: HookOption; result: HookScore; index: number }

export const MAX_HOOK_CHARS = 60

const WORD_RE = /[\p{L}\p{N}$%'’.+#-]*[\p{L}\p{N}%]/gu
const NUMBER_RE =
  /^(?:\$\s?\d[\d,]*(?:\.\d+)?[kmb]?|\d[\d,]*(?:\.\d+)?(?:%|x|k|m|b|gb|mb|ms|s|hrs?|hours?|mins?|minutes?|days?|weeks?|months?|years?)?)$/i

const set = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const SPOKEN_NUMBERS = set(
  'zero two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion dozen half twice triple double',
)
const UNIT_WORDS = set(
  'dollars dollar bucks grand percent cents minutes minute hours hour seconds second days weeks months years gigabytes megabytes tokens lines',
)
const STAKES = set(
  `stop never wrong mistake mistakes lost lose losing cost costs broke broken breaks failed failure
  fail fails nobody no not don't dont doesn't didn't can't won't quit fired deleted delete killed
  kills kill replaced replaces replace cut cuts beat beats free paid charged saved first banned
  illegal worst hate wasted waste scam lie lied truth secret hidden stole stolen before until
  instead but except unless problem risk danger warning regret should shouldn't still already only
  without versus vs actually now anymore faster slower cheaper smaller leak leaked leaks crash
  crashes crashed bug hacked outage dead fix fixes fixed just finally offline`,
)
const WEAK_OPENERS = [
  'so',
  'ok',
  'okay',
  'hey',
  'hi',
  'hello',
  'guys',
  'yo',
  'alright',
  'welcome',
  'today',
  'basically',
  'honestly',
  'look',
  'listen',
  'let',
  'lets',
  "let's",
  'i wanted',
  'i want',
  'one of',
  'have you',
  'did you',
  'do you',
  'are you',
  'in this',
  'in today',
  'the thing',
  'a lot',
  'there is',
  'there are',
  'it is',
  'as a',
  'when it',
  'you know',
  'imagine',
  'what if',
  'check out',
]
const IMPERATIVES = set(
  "stop steal copy delete try watch read save use build make write send take start quit never always don't dont do put run check",
)
const DEALBREAKERS: readonly [RegExp, string][] = [
  [/^\s*(?:stop scrolling|don'?t scroll)/i, 'opens with "stop scrolling"'],
  [
    /\b(?:in (?:this|today'?s) (?:video|reel)|i'?m going to show you|i'?ll show you how|let'?s talk about)\b/i,
    'video preamble; open on the payoff',
  ],
  [/^\s*(?:hey |hi |what'?s up |welcome )/i, 'greeting'],
  [/^\s*(?:have you ever|imagine|what if|check out)\b/i, 'weak opener'],
  [/(?:^|\s)#\w+/, 'hashtag in the hook'],
  [/[\u{1F300}-\u{1FAFF}☀-➿]/u, 'emoji in the hook'],
]

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const lower = (w: string) => w.toLowerCase().replace(/’/g, "'").replace(/[.]+$/, '')

export function hookWords(text: string): string[] {
  return text.replace(/(?<=\d),(?=\d)/g, '').match(WORD_RE) ?? []
}

const isConcrete = (w: string, i: number, names: ReadonlySet<string>): boolean => {
  const l = lower(w)
  if (NUMBER_RE.test(w) || SPOKEN_NUMBERS.has(l) || UNIT_WORDS.has(l)) return true
  if (isName(w, names)) return true
  return i > 0 && /^\p{Lu}\p{Ll}{2,}$/u.test(w)
}

function checkLength(text: string, n: number): number {
  let score = 100
  if (n < 5) score = 100 - (5 - n) * 20
  else if (n > 11) score = 100 - (n - 11) * 12
  const over = text.trim().length - MAX_HOOK_CHARS
  if (over > 0) score -= 10 + over * 2
  return clamp(score)
}

function checkSpecificity(words: string[], names: ReadonlySet<string>): number {
  const hits = words.filter((w, i) => isConcrete(w, i, names)).length
  return hits === 0 ? 15 : clamp(45 + hits * 30)
}

function checkStakes(text: string, words: string[]): number {
  const markers = new Set(words.map(lower).filter((w) => STAKES.has(w)))
  if (/\$\s?\d/.test(text)) markers.add('$')
  if (/\bused to\b|\bno longer\b|\binstead of\b/i.test(text)) markers.add('shift')
  return markers.size === 0 ? 20 : markers.size === 1 ? 70 : 100
}

function checkFrontload(words: string[], names: ReadonlySet<string>): number {
  const low = words.map(lower)
  const opener = low.slice(0, 2).join(' ')
  const weak = WEAK_OPENERS.some((w) => opener.startsWith(`${w} `) || opener === w || low[0] === w)
  const payload = words.findIndex((w, i) => STAKES.has(low[i]!) || isConcrete(w, i, names))
  const base = payload < 0 ? 30 : payload <= 3 ? 100 : payload <= 6 ? 70 : 40
  return clamp(base - (weak ? 30 : 0))
}

function checkAddress(text: string, words: string[]): number {
  if (/\b(?:you|your|you're|you’re|youre|yourself)\b/i.test(text)) return 100
  if (words[0] && IMPERATIVES.has(lower(words[0]))) return 90
  if (/\b(?:i|my|me|we|our)\b/i.test(text)) return 70
  return 50
}

const WEIGHTS: Record<HookCheck, number> = {
  length: 0.25,
  specificity: 0.3,
  stakes: 0.2,
  frontload: 0.2,
  address: 0.05,
}
const CAPPING: readonly HookCheck[] = ['length', 'specificity', 'stakes', 'frontload']

export function scoreHook(text: string, names: ReadonlySet<string> = new Set()): HookScore {
  const words = hookWords(text)
  const checks: Record<HookCheck, number> = {
    length: checkLength(text, words.length),
    specificity: checkSpecificity(words, names),
    stakes: checkStakes(text, words),
    frontload: words.length === 0 ? 0 : checkFrontload(words, names),
    address: checkAddress(text, words),
  }
  const flags = DEALBREAKERS.filter(([re]) => re.test(text)).map(([, why]) => why)
  const weighted = (Object.keys(WEIGHTS) as HookCheck[]).reduce(
    (sum, k) => sum + checks[k] * WEIGHTS[k],
    0,
  )
  const weakest = CAPPING.reduce((a, b) => (checks[b] < checks[a] ? b : a))
  const score = clamp(weighted * 0.6 + checks[weakest] * 0.4 - flags.length * 15)
  return {
    score: Math.round(score * 10) / 10,
    checks,
    weakest,
    flags,
    seconds: Math.round((spokenChars(text.trim()) / AURA_CHARS_PER_SECOND) * 10) / 10,
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The model's hook options as written, dropping malformed entries. */
export function readHookOptions(raw: unknown): HookOption[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((o): HookOption[] => {
    if (!isObj(o) || typeof o.spoken !== 'string' || !o.spoken.trim()) return []
    return [
      {
        spoken: o.spoken.trim(),
        ...(typeof o.formula === 'string' && o.formula.trim() ? { formula: o.formula.trim() } : {}),
        ...(typeof o.headline === 'string' && o.headline.trim()
          ? { headline: o.headline.trim() }
          : {}),
      },
    ]
  })
}

/** A favourite at or above this score is kept as written; it matches the style gate's minimum. */
export const KEEP_HOOK_SCORE = 50

const sameLine = (a: string, b: string) =>
  a
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim() ===
  b
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * The scorer is a gate, not a ranker: it catches weak hooks but cannot tell which of two decent
 * ones travels. So the writer's favourite (the line the rest of the script was written around)
 * stays unless it fails the gate.
 */
export function pickHook(
  options: readonly HookOption[],
  names: ReadonlySet<string> = new Set(),
  favourite?: string,
): HookPick | null {
  const scored = options.map((option, index) => ({
    option,
    index,
    result: scoreHook(option.spoken, names),
  }))
  const first = scored[0]
  if (!first) return null
  const best = scored.reduce((a, b) => (b.result.score > a.result.score ? b : a))
  const fav = (favourite && scored.find((s) => sameLine(s.option.spoken, favourite))) || first
  const keep = fav.result.flags.length === 0 && fav.result.score >= KEEP_HOOK_SCORE
  return keep ? fav : best
}

const ADVICE: Record<HookCheck, string> = {
  length: `too long or too short; write 6 to 10 words and at most ${MAX_HOOK_CHARS} characters`,
  specificity: 'nothing concrete in it; put a real number or a name from the sources in it',
  stakes:
    'nothing is at stake; show what changed, what it replaces, or what the viewer loses or gains',
  frontload:
    'the interesting word comes too late; put the number or the surprise in the first four words',
  address: 'it speaks to nobody; aim it at "you"',
}

export function hookAdvice(result: HookScore): string {
  return [ADVICE[result.weakest], ...result.flags].join('; ')
}
