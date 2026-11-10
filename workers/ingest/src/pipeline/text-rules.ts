// Shared text rules for on-screen words. This file is copied verbatim to
// workers/ingest/src/pipeline/text-rules.ts (script repair); a test there keeps the two identical.

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean))

const DETERMINERS = words(
  'a an the this that these those its their our your my his her some any each every all both no',
)
const PREPOSITIONS = words(
  'of to in on for with from by at as into onto over under via per about after before between during through without within across against along among around behind below beside beyond near since than toward towards until upon off out up down',
)
const FUNCTION = words(
  `${[...DETERMINERS].join(' ')} ${[...PREPOSITIONS].join(' ')}
  and or but nor so yet if then because although though unless while whether
  it it's they them there here we us you i me he she him who whom whose which what when where why how
  is are was were be been being am do does did done has have had having
  can could will would shall should may might must
  not yes just also only even still very really quite too much many few several other another such same own
  now soon already almost nearly roughly approximately again ever never always often sometimes once twice
  times instead rather plus vs versus etc like slash dot dash colon`,
)
/** Words that may open a key point although they are function words ("No official announcement"). */
const OK_START = words('no more less fewer most all every each both')
/** Words that leave a phrase hanging when they come last ("94.7% average", "the latest"). */
const DANGLING = words(
  'average worst best new latest top key main major big small large high low fast slow faster slower better worse larger smaller higher lower bigger first last next same own whole entire full total overall one',
)
const NOUN_ING = words(
  'training learning computing spoofing phishing streaming scheduling mixing building pricing hosting routing testing engineering programming rendering caching indexing ranking tracking logging debugging tooling packaging funding setting thing nothing something anything everything morning evening ceiling string spring king ring wing meeting reasoning thinking planning modeling modelling sampling fine-tuning finetuning prompting coding writing reading recording embedding encoding decoding parsing processing filtering serving',
)
const IRREGULAR_PAST = words(
  'took made ran fell got gave went came became built brought found kept left lost met paid said sent shown taken done seen written grown known began begun bought caught chose chosen drew driven fed felt fought flew forgot held hid hit led lent let lit meant put read rode rose sat sold shot shut slept spent stood stole struck swore swept swung taught told thought threw understood won wrote',
)
/** Base forms that are verbs far more often than nouns; their -s form is treated as a verb. */
const STRONG = words(
  'accelerate achieve affect align allow appear apply ask authenticate become lack bring cause choose come consolidate contain continue convert create deliver describe enable ensure expect explain find get give go guide happen help improve include increase introduce keep let lose make mean mitigate move need offer optimize optimise pass prevent provide raise reach receive recover reduce reject remain remove replace require reveal run say scramble see seem shrink solve speed surpass take tell think treat try turn unlock use want win write add bounce drop fall rise land hit jump slash cut double triple halve outperform beat leave lift support turn',
)
const AMBIGUOUS = words(
  'announce build change check clone compare compile cost cut deploy design end fail fix follow grow hold install launch lead learn look measure open plan play publish pull push release report return save scale ship show sign sound spend start stay stop switch test track train type update view wait watch work',
)
const BASES = new Set([...STRONG, ...AMBIGUOUS])
/** Base forms that are (almost) never nouns, so they end a noun chunk and never close a key point. */
const VERB_ONLY = words(
  'accelerate achieve affect align allow appear apply authenticate become bring cause choose consolidate contain continue convert create deliver describe enable ensure expect explain find get give go guide happen improve include increase introduce keep let lose make mean mitigate move need offer optimize optimise prevent provide raise reach receive recover reduce reject remain remove replace require reveal say scramble see seem shrink solve surpass take tell think treat try unlock want write outperform halve leave lift',
)
const ADVERB_OK = words(
  'only family supply assembly reply early daily weekly monthly yearly italy july fly',
)
const NUMBER_WORDS = words(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion half dozen',
)

export const bare = (w: string): string =>
  w.replace(/^[^\p{L}\p{N}@$~+#]+|[^\p{L}\p{N}%²³⁰-⁹×+#)]+$/gu, '').replace(/[)]+$/, '')
const low = (w: string) => bare(w).toLowerCase()

export const isFunctionWord = (w: string): boolean => FUNCTION.has(low(w))
export const isNumberWord = (w: string): boolean => NUMBER_WORDS.has(low(w)) || low(w) === 'point'

function stemsOf(w: string): string[] {
  const out: string[] = []
  const add = (s: string) => s.length >= 2 && out.push(s)
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`)
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s')) add(w.slice(0, -1))
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`)
  if (w.endsWith('ed')) {
    add(w.slice(0, -2))
    add(w.slice(0, -1))
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3))
  }
  if (w.endsWith('ing')) {
    add(w.slice(0, -3))
    add(`${w.slice(0, -3)}e`)
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4))
  }
  return out
}

/** An inflected verb form: "makes", "raised", "surpassing", "took". Base forms are not flagged. */
export function isVerbForm(w: string): boolean {
  const l = low(w)
  if (!l || NOUN_ING.has(l)) return false
  if (IRREGULAR_PAST.has(l)) return true
  if (l.endsWith('ing') || l.endsWith('ed')) return stemsOf(l).some((s) => BASES.has(s))
  if (l.endsWith('s')) return stemsOf(l).some((s) => STRONG.has(s))
  return false
}

const isAdverb = (w: string) => {
  const l = low(w)
  return l.length > 4 && l.endsWith('ly') && !ADVERB_OK.has(l)
}

/** A token that looks like a product or proper name: DMARC, P²-MOPD, GPT-4, Fizgig (when in `names`). */
export function isName(w: string, names: ReadonlySet<string> = new Set()): boolean {
  const b = bare(w)
  if (b.length < 2 || !/\p{L}/u.test(b)) return false
  if (names.has(b.toLowerCase())) return true
  if (/^[A-Z0-9]{2,}$/.test(b) && /[A-Z]/.test(b)) return true
  if (/^\p{Lu}/u.test(b) && /\p{Lu}|\d|[²³]/u.test(b.slice(1))) return true
  return /^[@#]?[\p{L}\d]+[.-][\p{L}\d.-]+$/u.test(b) && /\p{Lu}|\./u.test(b)
}

export function nameSet(...texts: (string | undefined)[]): Set<string> {
  const out = new Set<string>()
  for (const t of texts) {
    const toks = (t ?? '')
      .split(/[\s/:|,]+/)
      .map(bare)
      .filter(Boolean)
    const caps = toks.filter((b) => /^\p{Lu}/u.test(b)).length
    const titleCase = toks.length >= 3 && caps / toks.length >= 0.6
    toks.forEach((b, i) => {
      if (b.length < 3 || !/^\p{Lu}/u.test(b) || FUNCTION.has(b.toLowerCase())) return
      if ((titleCase || i === 0) && !isName(b)) return
      out.add(b.toLowerCase())
    })
  }
  return out
}

/** Trims spaces, wrapping quotes and trailing punctuation. */
export const cleanPhrase = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“‘(]+|["'”’)]+$/g, '')
    .replace(/[\s.,;:!?…\-–—]+$/g, '')
    .trim()

const countable = (tokens: readonly string[]) => tokens.filter((t) => /[\p{L}\p{N}]/u.test(t))

export type PhraseOpts = {
  names?: ReadonlySet<string>
  allowVerbStart?: boolean
  allowParticipleStart?: boolean
  /** A claim may open on an article ("The fix is one DNS record"); labels may not ("The latest"). */
  allowArticleStart?: boolean
}

/**
 * A key point must read as a complete idea: 2-6 words, starting and ending on a content word, never
 * ending on a verb, function word, adverb or hanging adjective, never a lone word (names included:
 * a one-word hero says nothing). Returns the cleaned text, or null.
 */
export function validKeyPoint(text: string, opts: PhraseOpts = {}): string | null {
  const clean = cleanPhrase(text)
  if (!clean) return null
  const tokens = clean.split(' ')
  const counted = countable(tokens)
  const first = counted[0]
  const last = counted[counted.length - 1]
  if (!first || !last) return null
  if (counted.length === 1) return null
  if (counted.length > 6) return null
  if (/[,;:]$/.test(tokens[tokens.length - 1] ?? '')) return null
  const firstLow = low(first)
  const article = opts.allowArticleStart && /^(?:the|a|an)$/.test(firstLow)
  if (FUNCTION.has(firstLow) && !OK_START.has(firstLow) && !article) return null
  if (isAdverb(first)) return null
  const participle = opts.allowParticipleStart && /ed$/i.test(bare(first))
  if (isVerbForm(first) && !opts.allowVerbStart && !participle) return null
  if (opts.allowVerbStart && isVerbForm(first) && !/s$/i.test(bare(first)) && !participle)
    return null
  if (VERB_ONLY.has(firstLow) && !opts.allowVerbStart) return null
  if (FUNCTION.has(low(last)) || DANGLING.has(low(last)) || isAdverb(last)) return null
  if (isVerbForm(last) || VERB_ONLY.has(low(last))) return null
  if (/^[\d.,]+$/.test(bare(last)) && counted.length === 2 && /^[\d.,]+$/.test(bare(first))) {
    return null
  }
  return clean
}

type Tok = { raw: string; word: string; stop: boolean }

function tokenize(text: string): Tok[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, word: bare(raw), stop: /[.,;:!?…)\]"”]$/.test(raw) }))
    .filter((t) => t.word.length > 0 || t.raw === '&')
}

const LINKS = words('of &')

function isAdjectiveParticiple(prev: Tok | undefined, next: Tok | undefined): boolean {
  if (!next) return false
  const nextContent = !FUNCTION.has(next.word.toLowerCase()) && !isVerbForm(next.word)
  if (!nextContent) return false
  if (!prev || prev.stop) return true
  const p = prev.word.toLowerCase()
  return DETERMINERS.has(p) || PREPOSITIONS.has(p) || BASES.has(p) || isVerbForm(prev.word)
}

function breaks(t: Tok, prev: Tok | undefined, next: Tok | undefined): boolean {
  const l = t.word.toLowerCase()
  if (t.raw === '&') return false
  if (FUNCTION.has(l) && !NUMBER_WORDS.has(l)) return true
  if (isAdverb(t.word) || VERB_ONLY.has(l)) return true
  if (isVerbForm(t.word)) {
    if (/ed$/.test(l) && isAdjectiveParticiple(prev, next)) return false
    return true
  }
  return false
}

/** Noun-like chunks of a sentence, best first: runs of content words cut at verbs, function words and punctuation. */
export function nounChunks(text: string, opts: PhraseOpts = {}): string[] {
  const toks = tokenize(text)
  const runs: Tok[][] = []
  let cur: Tok[] = []
  const flush = () => {
    if (cur.length > 0) runs.push(cur)
    cur = []
  }
  toks.forEach((t, i) => {
    const prev = toks[i - 1]
    const next = toks[i + 1]
    const link = LINKS.has(t.word.toLowerCase()) || t.raw === '&'
    if (link && cur.length > 0 && next && !breaks(next, t, toks[i + 2]) && !prev?.stop) {
      cur.push(t)
      return
    }
    if (breaks(t, prev, next)) {
      flush()
      return
    }
    cur.push(t)
    if (t.stop) flush()
  })
  flush()
  const scored: { text: string; score: number; at: number }[] = []
  runs.forEach((run, at) => {
    let r = [...run]
    while (
      r.length > 0 &&
      (LINKS.has(r[r.length - 1]!.word.toLowerCase()) || r[r.length - 1]!.raw === '&')
    )
      r = r.slice(0, -1)
    while (r.length > 0 && (LINKS.has(r[0]!.word.toLowerCase()) || r[0]!.raw === '&'))
      r = r.slice(1)
    while (r.length > 5) r = r.slice(1)
    const phrase = r.map((t) => t.word).join(' ')
    const head = r[0]
    const participle = Boolean(head && /ed$/i.test(head.word) && isVerbForm(head.word))
    const ok = validKeyPoint(phrase, { names: opts.names, allowParticipleStart: participle })
    if (!ok) return
    const names = r.filter((t) => isName(t.word, opts.names) || /\d/.test(t.word)).length
    const n = countable(r.map((t) => t.word)).length
    const score = names * 2 + Math.min(n, 4) - (n === 1 ? 1.5 : 0) - (n > 4 ? 1 : 0)
    scored.push({ text: ok, score, at })
  })
  const seen = new Set<string>()
  return scored
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .map((s) => s.text)
    .filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
}

const contentOf = (s: string) =>
  new Set(
    s
      .split(/\s+/)
      .map((w) => low(w).replace(/^@/, ''))
      .filter((w) => w.length > 2 && !FUNCTION.has(w)),
  )
/** Crude stem so "authenticates" ~ "authenticated", "domain" ~ "domains". */
const stem = (w: string) => (w.length > 5 ? w.slice(0, Math.max(5, w.length - 3)) : w)

/** Same text, or two phrases that share two content words ("linear combination" ~ "linear parameter combination"). */
export function nearDuplicate(a: string, b: string): boolean {
  const x = a.toLowerCase().trim()
  const y = b.toLowerCase().trim()
  if (x === y) return true
  const wa = new Set([...contentOf(x)].map(stem))
  return [...new Set([...contentOf(y)].map(stem))].filter((w) => wa.has(w)).length >= 2
}

export type KeyPointSource = {
  given?: string
  /** The model's sub line; a label with a real sub line (>= 3 words) reads as a card, not a fragment. */
  sub?: string
  claims?: readonly string[]
  text: string
  context?: string
  names?: ReadonlySet<string>
  avoid?: ReadonlySet<string>
}

const PRONOUN_SUBJECTS = words('it this that these those they we you i he she')
const DEMONSTRATIVES = words('this that these those')
const MODALS = words('can could will would should may might must')
const COPULAS = words('is are was were')
const DROPPABLE = words(
  'now also often just still already really even too simply finally actually then quietly jointly much very',
)
const CLAUSE_LEADS = words(
  'and but so or yet then plus while whereas although though because since if when',
)
/** Words a claim may be cut before: the clause after them is extra detail, not part of the idea. */
const CUT_BEFORE = words(
  'from in on for with by at into via per about after before between during through within across against along among around until upon and or but so yet because although though unless while whether if when where which who',
)
const NEGATION =
  /^(?:doesn't|don't|didn't|isn't|aren't|wasn't|weren't|won't|can't|cannot|never|not)$/i

const isPredicate = (w: string, i: number, prev = ''): boolean => {
  const l = low(w)
  if (NEGATION.test(l)) return true
  if (COPULAS.has(l)) return i > 0
  if (isVerbForm(w)) return true
  if (!BASES.has(l)) return false
  const p = low(prev)
  return i === 0 || (/[^s]s$/.test(p) && !isVerbForm(prev) && !FUNCTION.has(p))
}

/** The phrase states something: it has a verb (or a "Name: point" headline form). */
export function hasPredicate(text: string): boolean {
  const toks = cleanPhrase(text).split(' ').filter(Boolean)
  if (/^[^:]{2,40}:\s*\S/.test(text)) return true
  if (/^(?:no|zero|not)$/i.test(toks[0] ?? '') && toks.length >= 2) return true
  return toks.some((t, i) => isPredicate(t, i, toks[i - 1]))
}

const SPELLED_QUANTITY = new RegExp(
  `\\b(?:${[...NUMBER_WORDS].filter((w) => w !== 'one').join('|')})\\b`,
  'i',
)

/** A key point that adds a number nobody can check (a spelled-out or real quantity) is a stat, not a point. */
export const carriesQuantity = (text: string): boolean =>
  SPELLED_QUANTITY.test(text) ||
  findQuantities(text).length > 0 ||
  /\b\d+(?:\.\d+)?[BM]\b/.test(text)

const capFirst = (t: string) =>
  /^[a-z][a-z'-]*$/.test(t.split(' ')[0] ?? '') ? t[0]!.toUpperCase() + t.slice(1) : t

function claimTokens(clause: string): string[] {
  let toks = clause
    .split(/\s+/)
    .map((t) => t.replace(/[.!?]+$/, ''))
    .filter(Boolean)
  while (toks.length > 0 && CLAUSE_LEADS.has(low(toks[0]!))) toks = toks.slice(1)
  const head = low(toks[0] ?? '')
  if (PRONOUN_SUBJECTS.has(head)) {
    const nounSubject =
      DEMONSTRATIVES.has(head) &&
      toks[1] &&
      !isPredicate(toks[1], 1) &&
      !MODALS.has(low(toks[1])) &&
      toks[2] &&
      isPredicate(toks[2], 2)
    toks = toks.slice(nounSubject ? 2 : 1)
  }
  while (toks.length > 0 && (MODALS.has(low(toks[0]!)) || DROPPABLE.has(low(toks[0]!))))
    toks = toks.slice(1)
  if (toks.length > 0 && COPULAS.has(low(toks[0]!))) return []
  const out: string[] = []
  toks.forEach((t, i) => {
    const l = low(t)
    if (DROPPABLE.has(l) || (isAdverb(t) && !NEGATION.test(l))) return
    if (
      (l === 'has' || l === 'have') &&
      /(?:ing|ed)$/i.test(toks[i + 1] === 'been' ? (toks[i + 2] ?? '') : (toks[i + 1] ?? ''))
    )
      return
    if (l === 'been' && /ing$/i.test(toks[i + 1] ?? '')) return
    out.push(t)
  })
  return out
}

/** A clause with its pronoun subject, modals and filler adverbs dropped ("This affects mail to" -> "affects mail to"). */
export const claimTokensOf = (clause: string): string[] => claimTokens(clause)

/**
 * Short claims a sentence makes, in headline form: "MOPD is a heavy pipeline", "Uses experts as
 * parameter priors", "Fix a broken LoRA block". Each is one clause with its verb, at most 6 words,
 * cut only where the rest is extra detail (before a preposition or conjunction, never before "of",
 * "to", "as", "than" or "without"), and passes `validKeyPoint`. Quantities are left to stat screens.
 */
export function claimPhrases(sentence: string, opts: PhraseOpts = {}): string[] {
  const text = sentence.replace(/(\S+)\s+slash\s+(\S+)/gi, '$1/$2')
  const clauses = text
    .split(/(?<=[.!?])\s+|[,;:]\s+|\s+[—–-]{1,2}\s+|[—–]/)
    .flatMap((c) => c.split(/\s+(?:and|but)\s+(?=(?:doesn't|don't|isn't|never|\S+(?:s|ed))\b)/i))
  const out: string[] = []
  for (const clause of clauses) {
    const toks = claimTokens(clause)
    if (toks.length < 2) continue
    const variants = /^(?:the|a|an)$/i.test(toks[0]!) ? [toks, toks.slice(1)] : [toks]
    const found = variants.map((v) => firstClaim(v, opts)).find(Boolean)
    if (found) out.push(capFirst(found))
  }
  return [...new Set(out)]
}

/** "block by block", "step by step", "side to side": the phrase ends inside a fixed pairing. */
const insidePairing = (toks: readonly string[], n: number): boolean => {
  const l = low(toks[n] ?? '')
  return (
    (l === 'by' || l === 'to' || l === 'after' || l === 'for') &&
    n > 0 &&
    low(toks[n - 1] ?? '') === low(toks[n + 1] ?? '')
  )
}

const cutsBefore = (toks: readonly string[], n: number): boolean => {
  const l = low(toks[n] ?? '')
  if (insidePairing(toks, n)) return false
  if (!CUT_BEFORE.has(l)) return false
  if (l !== 'and' && l !== 'or') return true
  const next = toks[n + 1] ?? ''
  return (
    isVerbForm(next) ||
    BASES.has(low(next)) ||
    NEGATION.test(next) ||
    PRONOUN_SUBJECTS.has(low(next))
  )
}

function firstClaim(toks: readonly string[], opts: PhraseOpts): string | null {
  const counted = (n: number) => countable(toks.slice(0, n)).length
  const ends: number[] = []
  if (countable([...toks]).length <= 6) ends.push(toks.length)
  else
    for (let n = 2; n < toks.length && counted(n) <= 6; n += 1)
      if (cutsBefore(toks, n)) ends.push(n)
  for (const n of ends) {
    const phrase = toks.slice(0, n).join(' ')
    if (!hasPredicate(phrase) || carriesQuantity(phrase)) continue
    const ok = validKeyPoint(phrase, {
      names: opts.names,
      allowVerbStart: true,
      allowParticipleStart: true,
      allowArticleStart: true,
    })
    if (ok) return ok
  }
  return null
}

/** Text the model gave a key point is kept only when it states something (see `hasPredicate`). */
export function isClaimLike(text: string, sub = ''): boolean {
  if (countable(cleanPhrase(text).split(' ')).length < 2) return false
  if (carriesQuantity(text)) return false
  const subOk = !carriesQuantity(sub) && countable(cleanPhrase(sub).split(' ')).length >= 3
  return hasPredicate(text) || subOk
}

/**
 * Key point text for a moment of narration, or null: never a bare label.
 */
export function keyPointText(src: KeyPointSource): string | null {
  return keyPointOptions(src, 1)[0] ?? null
}

/**
 * Up to `n` distinct key point texts by priority: the model's text when it is a valid claim, a short
 * claim from the script about the same thing, a claim of the sentence being spoken. A label ("Linear
 * parameter combination", "SPF", "1.7B model") is never returned: no text means no key point.
 */
export function keyPointOptions(src: KeyPointSource, n = 2): string[] {
  const out: string[] = []
  const push = (t: string | null) => {
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  const names = src.names
  const avoid = [...(src.avoid ?? [])]
  const fresh = (t: string | null) => (t && !avoid.some((a) => nearDuplicate(a, t)) ? t : null)
  if (src.given && isClaimLike(src.given, src.sub)) {
    push(
      fresh(validKeyPoint(src.given, { names, allowVerbStart: true, allowParticipleStart: true })),
    )
  }
  const spoken = contentOf(src.text)
  const about = (t: string) => [...contentOf(t)].filter((w) => spoken.has(w)).length
  const close = (t: string) => about(t) >= Math.min(2, contentOf(t).size)
  for (const claim of src.claims ?? []) {
    if (out.length >= n) return out
    if (!close(claim)) continue
    const short = cleanPhrase(claim).replace(/^(?:the|a|an)\s+/i, '')
    const direct =
      countable(short.split(' ')).length <= 6 && isClaimLike(short)
        ? validKeyPoint(short, { names, allowVerbStart: true })
        : null
    push(fresh(direct ? capFirst(direct) : null))
  }
  const around = claimPhrases(src.context ?? '', { names }).sort((a, b) => about(b) - about(a))
  for (const t of around.filter((c) => about(c) > 0)) {
    if (out.length >= n) break
    push(fresh(t))
  }
  return out.slice(0, n)
}

// ---------------------------------------------------------------------------------------------
// Numbers

export type Quantity = {
  /** Display value: "94.7%", "12×", "20 min", "$1.2M". */
  raw: string
  value: number
  unit: string
  index: number
  end: number
}

const UNITS: Record<string, string> = {
  '%': '%',
  percent: '%',
  x: '×',
  '×': '×',
  times: '×',
  k: 'k',
  m: 'M',
  b: 'B',
  thousand: 'k',
  million: 'M',
  billion: 'B',
  gb: 'GB',
  mb: 'MB',
  tb: 'TB',
  kb: 'KB',
  gigabytes: 'GB',
  megabytes: 'MB',
  ms: 'ms',
  milliseconds: 'ms',
  s: 's',
  seconds: 's',
  sec: 's',
  min: 'min',
  mins: 'min',
  minutes: 'min',
  hours: 'h',
  hour: 'h',
  h: 'h',
  days: 'days',
  fps: 'fps',
  ghz: 'GHz',
  mhz: 'MHz',
  stars: 'stars',
  users: 'users',
  tokens: 'tokens',
  steps: 'steps',
  points: 'points',
}
const QUANTITY = new RegExp(
  String.raw`(?<pre>~|\+|\$|€|£)?(?<num>\d[\d,]*(?:\.\d+)?)(?:\s?(?<unit>%|×|x\b|[kKmMbB]\b|percent\b|thousand\b|million\b|billion\b|GB\b|MB\b|TB\b|KB\b|gigabytes\b|megabytes\b|ms\b|milliseconds\b|seconds\b|sec\b|s\b|min\b|mins\b|minutes\b|hours?\b|h\b|days\b|fps\b|GHz\b|MHz\b|times\b|stars\b|users\b|tokens\b|steps\b|points\b))?`,
  'gi',
)
/** "nearly 90%" is shown "~90%", never a bare 90% that overstates the claim. */
const QUALIFIER =
  /\b(nearly|almost|about|around|roughly|approximately|over|more than|under|less than|up to)\s+$/i
const QUALIFIER_SIGN: Record<string, string> = {
  nearly: '~',
  almost: '~',
  about: '~',
  around: '~',
  roughly: '~',
  approximately: '~',
  over: '>',
  'more than': '>',
  under: '<',
  'less than': '<',
  'up to': '≤',
}
const MONTHS = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i
const MODEL_AFTER = /^\s*(?:model|models|parameters?|params|-?parameter)\b/i

/**
 * Real quantities in text (digits only): skips years, dates, ordinals, versions (2.15, v3, 1.2.3),
 * product and model numbers (RTX 5090, GPT-4, M3, Qwen3, a 1.7B model) and numbers glued to words.
 */
export function findQuantities(text: string): Quantity[] {
  const out: Quantity[] = []
  for (const m of text.matchAll(QUANTITY)) {
    const index = m.index ?? 0
    const num = m.groups?.num ?? ''
    const unitRaw = m.groups?.unit ?? ''
    const pre = m.groups?.pre ?? ''
    const end = index + m[0].length
    const value = Number(num.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const before = text.slice(Math.max(0, index - 30), index)
    const after = text.slice(index + num.length + pre.length, index + num.length + pre.length + 14)
    if (/[\p{L}_^]$|[\p{L}\d]-$|[\d.]$/u.test(before)) continue
    if (/^\.\d/.test(text.slice(end, end + 2)) || /^(?:st|nd|rd|th)\b/i.test(after)) continue
    if (/\bv(?:ersion)?\s?$/i.test(before) || /^-[\p{L}\d]/u.test(after)) continue
    if (MONTHS.test(before) || /^\s*(?:,\s*)?\d{4}\b/.test(after.replace(/^,/, ','))) {
      if (!unitRaw) continue
    }
    if (!unitRaw && !pre && /(?:^|\s)(?:\p{Lu}[\p{L}\d-]*|[A-Z]{2,}\d*)\s$/u.test(before)) continue
    if (!unitRaw && !pre && value >= 1900 && value <= 2100 && !num.includes('.')) continue
    const unit = unitRaw ? (UNITS[unitRaw.toLowerCase()] ?? unitRaw) : ''
    if ((unit === 'B' || unit === 'M') && MODEL_AFTER.test(text.slice(end))) continue
    if (/^\s?[\p{L}]/u.test(text.slice(end, end + 2)) && !unit) {
      const next = /^\s?([\p{L}]+)/u.exec(text.slice(end))?.[1] ?? ''
      if (/^\p{Lu}/u.test(next) && !/^\p{Lu}+$/u.test(next) && value < 100) continue
    }
    if (/\bfrom\s$/i.test(before) && /^\s*(?:to|→|->)\s*[~$]?\d/.test(text.slice(end))) continue
    if (!unit && !pre && value < 10 && !num.includes('.')) continue
    if (!unit && !pre && !num.includes(',') && !/^\s[a-z]/.test(text.slice(end, end + 2))) continue
    const spaced =
      unit && /^[a-zA-Z]{2,}$/.test(unit) && !['GB', 'MB', 'TB', 'KB', 'GHz', 'MHz'].includes(unit)
    const said = QUALIFIER.exec(before)?.[1]?.toLowerCase()
    const sign = said && !pre ? (QUALIFIER_SIGN[said] ?? '') : ''
    const raw = `${sign}${pre}${num}${spaced ? ' ' : ''}${unit}`
    out.push({ raw, value: Math.round(value * 1000) / 1000, unit, index, end })
  }
  return out
}

/** A StatSlam value must be one quantity: "94.7%", "12×", "$1.2M", "20 min", "1,240". */
export function isQuantityValue(raw: string): boolean {
  const s = raw.trim()
  const q = findQuantities(/^[\d.,]+$/.test(s) ? `${s} units` : s)
  if (q.length !== 1) return false
  const left = (s.slice(0, q[0]!.index) + s.slice(q[0]!.end)).replace(
    /[\s~+$€£×%<>≤]|up to|over|about|nearly/gi,
    '',
  )
  return left === '' || /^[a-z]{1,8}$/i.test(left)
}

/** Value of a displayed stat, multiplier suffixes applied ("1.2k" -> 1200), or null. */
export function quantityValue(raw: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?([kKmMbB]\b|thousand|million|billion)?/.exec(raw)
  if (!m?.[1]) return null
  const base = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const s = (m[2] ?? '').toLowerCase()
  const mult =
    s === 'k' || s === 'thousand'
      ? 1e3
      : s === 'm' || s === 'million'
        ? 1e6
        : s === 'b' || s === 'billion'
          ? 1e9
          : 1
  return Math.round(base * mult * 1000) / 1000
}

/** "80.9" matches 80.93 and 80.9; precision is the narrated number's. */
export function sameNumber(narrated: string, cell: string): boolean {
  const a = /(-?\d[\d,]*(?:\.(\d+))?)/.exec(narrated)
  const b = /(-?\d[\d,]*(?:\.\d+)?)/.exec(cell)
  if (!a?.[1] || !b?.[1]) return false
  const x = Number(a[1].replace(/,/g, ''))
  const y = Number(b[1].replace(/,/g, ''))
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  const dp = a[2]?.length ?? 0
  const f = 10 ** dp
  return Math.round(y * f) === Math.round(x * f)
}

// ---------------------------------------------------------------------------------------------
// Code

/** A code line that reads as complete: no trailing operator, balanced quotes and brackets. */
export function isCompleteCodeLine(line: string): boolean {
  const l = line.trim()
  if (l.length < 4) return false
  if (/[=,(\[{+\-*/\\|&]$/.test(l)) return false
  for (const q of ['"', "'", '`']) if ((l.split(q).length - 1) % 2 === 1) return false
  const depth = (o: string, c: string) => l.split(o).length - l.split(c).length
  return depth('(', ')') === 0 && depth('[', ']') === 0 && depth('{', '}') <= 0
}

// ---------------------------------------------------------------------------------------------
// Labels

const COMPARATIVE =
  /^(?:faster|slower|cheaper|smaller|larger|bigger|lighter|better|more|less|fewer|higher|lower|shorter|longer)$/i
const UNIT_WORDS = words(
  'percent times minutes minute mins min hours hour seconds second sec days day gigabytes megabytes stars users tokens steps points thousand million billion x',
)

type Span = { word: string; raw: string; start: number; end: number }

function spans(text: string): Span[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({
    raw: m[0],
    word: bare(m[0]),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))
}

const isLabelWord = (s: Span) => {
  const l = s.word.toLowerCase()
  return (
    s.word.length > 0 &&
    !FUNCTION.has(l) &&
    !UNIT_WORDS.has(l) &&
    !isVerbForm(s.word) &&
    !VERB_ONLY.has(l) &&
    !isAdverb(s.word) &&
    !/^[\d.,%$~+×]+$/.test(s.word)
  )
}

function afterLabel(toks: Span[], end: number, max: number): string[] {
  const after = toks.filter((t) => t.start >= end)
  let i = 0
  if (after[0] && UNIT_WORDS.has(after[0].word.toLowerCase())) i = 1
  const out: string[] = []
  const nounAfterNumber = (t: Span) =>
    i === 0 && isVerbForm(t.word) && /s$/i.test(t.word) && !FUNCTION.has(t.word.toLowerCase())
  for (; i < after.length; i += 1) {
    const t = after[i]!
    if (!isLabelWord(t) && !nounAfterNumber(t)) break
    out.push(t.word)
    if (out.length >= max || /[.,;:!?)]$/.test(t.raw)) break
  }
  return out
}

function subjectBefore(toks: Span[], start: number, max: number): string[] {
  const before = toks.filter((t) => t.end <= start).reverse()
  const out: string[] = []
  let skipped = 0
  for (const [k, t] of before.entries()) {
    if (/[.;:!?]$/.test(t.raw) || (/,$/.test(t.raw) && out.length > 0)) break
    const versioned =
      /^\d+$/.test(t.word) && out.length > 0 && /^\p{Lu}/u.test(before[k + 1]?.word ?? '')
    if (versioned) {
      out.unshift(t.word)
      continue
    }
    if (!isLabelWord(t) || NUMBER_WORDS.has(t.word.toLowerCase())) {
      if (out.length > 0) break
      skipped += 1
      if (skipped > 4) break
      continue
    }
    out.unshift(t.word.replace(/['’]s$/i, ''))
    if (out.length >= max || /,$/.test(t.raw)) break
  }
  if (out.length === 0) return out
  const first = before.findIndex(
    (t) => t.word === out[0] || t.word.replace(/['’]s$/i, '') === out[0],
  )
  const lead = before.slice(first + 1).find((t) => !DETERMINERS.has(t.word.toLowerCase()))
  const gerund =
    lead &&
    /ing$/i.test(lead.word) &&
    (NOUN_ING.has(lead.word.toLowerCase()) || isVerbForm(lead.word))
  if (gerund && out.length < max + 1) out.push(lead!.word.toLowerCase())
  return out
}

/**
 * What the sentence says a number is: the noun phrase after it ("94.7% average recovery"), the
 * owner for "X's 80.9%" / "80.9% for X" (borrowing a sibling number's noun: "MOPD average
 * recovery"), a comparative with its subject ("faster · Muon optimizer"), else the subject before it.
 */
export function numberLabel(sentence: string, at: { start: number; end: number }, max = 3): string {
  const base = baseLabel(sentence, at, max)
  const from = /\bfrom\s+([~$]?\d[\d,]*(?:\.\d+)?)\s*(?:to|→|->)\s*$/i.exec(
    sentence.slice(0, at.start),
  )?.[1]
  const was =
    /^\s*(?:[a-z%×]+\b)?[\s,]*(?:instead of|down from|up from|compared to|compared with|versus|vs\.?)\s+([~$]?\d[\d,]*(?:\.\d+)?)(?!\d|\.\d)/i.exec(
      sentence.slice(at.end),
    )?.[1]
  if (!from && was) {
    const unit = findQuantities(sentence.slice(at.start))[0]?.unit ?? ''
    const joined = unit && !/^[a-z]/.test(unit) ? `${was}${unit}` : unit ? `${was} ${unit}` : was
    return [base, `was ${joined}`].filter(Boolean).join(' · ')
  }
  if (!from) return base
  const unit = findQuantities(sentence.slice(at.start))[0]?.unit ?? ''
  const joined = unit && !/^[a-z]/.test(unit) ? `${from}${unit}` : unit ? `${from} ${unit}` : from
  return [base, `from ${joined}`].filter(Boolean).join(' · ')
}

function baseLabel(sentence: string, at: { start: number; end: number }, max: number): string {
  const toks = spans(sentence)
  const own = afterLabel(toks, at.end, max)
  const siblings = findQuantities(sentence)
    .filter((q) => q.index !== at.start && (q.index < at.start || q.index > at.end))
    .map((q) => afterLabel(toks, q.end, max))
    .filter((l) => l.length > 0 && !COMPARATIVE.test(l[0]!))
  const prev = toks.filter((t) => t.end <= at.start).reverse()[0]
  const possessive = prev && /['’]s$/i.test(prev.raw) ? prev.word.replace(/['’]s$/i, '') : ''
  const nextRaw = toks.filter((t) => t.start >= at.end)
  const forOwner =
    nextRaw[0]?.word.toLowerCase() === 'for' && nextRaw[1] && isLabelWord(nextRaw[1])
      ? nextRaw[1].word
      : ''
  const owner = possessive || forOwner
  if (owner && (own.length === 0 || own[0]!.toLowerCase() === 'for')) {
    return [owner, ...(siblings[0] ?? [])].join(' ')
  }
  if (own.length > 0 && COMPARATIVE.test(own[0]!)) {
    const subject = subjectBefore(toks, at.start, 2)
    return subject.length > 0 ? `${own[0]} · ${subject.join(' ')}` : own.join(' ')
  }
  if (own.length > 0) {
    const who = subjectBefore(toks, at.start, 1).filter((w) => isName(w))
    const owned = who.length > 0 && !own.some((w) => w.toLowerCase() === who[0]!.toLowerCase())
    return (owned ? [who[0]!, ...own] : own).join(' ')
  }
  return subjectBefore(toks, at.start, max).join(' ')
}

const SIZE_UNITS = new Set(['GB', 'MB', 'TB', 'KB'])
const MEMORY_WORD = /\b(memory|vram|ram|disk|storage|download|size|footprint)\b/i

/**
 * A size label says what was measured: "Krea 2 training · from 22.9GB" becomes "Krea 2 training
 * memory · from 22.9GB" when the narration is about memory (VRAM).
 */
export function withMeasure(label: string, unit: string, text: string): string {
  if (!SIZE_UNITS.has(unit) || !label || MEMORY_WORD.test(label)) return label
  const said = /\b(vram|memory)\b/i.exec(text)?.[1]
  if (!said) return label
  const word = said.toLowerCase() === 'vram' ? 'VRAM' : 'memory'
  const [head, ...rest] = label.split(' · ')
  return [`${head} ${word}`, ...rest].join(' · ')
}
