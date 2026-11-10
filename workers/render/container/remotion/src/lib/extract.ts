export type Found = { raw: string; label: string; index: number; unit: boolean }

const UNIT = '%|x|×|[kKmMbB]|GB|MB|TB|KB|ms|fps|GHz|MHz|percent|billion|million|thousand'
const NUMBER = new RegExp(
  `(?<pre>up to |over |about |nearly |~|\\+|\\$)?(?<num>\\d[\\d,]*(?:\\.\\d+)?)(?<unit>\\s?(?:${UNIT})\\b|%)?`,
  'gi',
)
const STOP_AFTER = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
])

function labelAfter(text: string, end: number): string {
  const words = text.slice(end).split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) {
    const clean = w.replace(/[^\w'-]/g, '')
    if (!clean || STOP_AFTER.has(clean.toLowerCase())) break
    out.push(clean)
    if (out.length >= 3 || /[.,;:!?]$/.test(w)) break
  }
  return out.join(' ')
}

/** Numbers worth a big reveal: units, percents or a count next to a noun. Skips years, ordinals and version names. */
export function findNumbers(text: string): Found[] {
  const found: Found[] = []
  for (const m of text.matchAll(NUMBER)) {
    const index = m.index ?? 0
    const num = m.groups?.num ?? ''
    const unit = m.groups?.unit ?? ''
    const pre = m.groups?.pre ?? ''
    const end = index + m[0].length
    const value = Number(num.replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const before = text.slice(Math.max(0, index - 24), index)
    const after = text.slice(end, end + 3)
    if (/^(st|nd|rd|th)\b/i.test(after)) continue
    if (!unit && !pre && value >= 1900 && value <= 2100) continue
    if (!unit && /[A-Za-z]\s?$/.test(before) && /[A-Z][\w-]*\s$/.test(before)) continue
    if (/[A-Za-z]$/.test(text.slice(0, index))) continue
    if (!unit && !pre && value < 10) continue
    if (!unit && !/^\s+[a-z]/.test(text.slice(end, end + 3)) && !/,/.test(num)) continue
    const raw = `${/^(up to|over|about|nearly)/i.test(pre) ? '' : pre}${num}${unit}`.trim()
    found.push({ raw, label: labelAfter(text, end), index, unit: Boolean(unit) })
  }
  return found
}

/** Splits on sentence punctuation followed by a space, so "1.7B" and "outlook.com" stay whole. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?]["')\]]*)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const TRAILING = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
  'or',
  'with',
  'for',
  'in',
  'on',
  'is',
  'that',
  'your',
])

/** Headline from the hook: first clause, at most `max` words, no dangling stopword. */
export function headlineFrom(hook: string, max = 7): string {
  const first = sentences(hook)[0] ?? hook
  const clean = first.replace(/[…]+$/g, '').replace(/\s+/g, ' ').trim()
  let words = clean.split(' ')
  if (words.length > max) {
    const clause = clean.split(/[,:;—–-]\s/)[0] ?? clean
    words =
      clause.split(' ').length >= 3 && clause.split(' ').length <= max
        ? clause.split(' ')
        : words.slice(0, max)
  }
  while (
    words.length > 2 &&
    TRAILING.has((words[words.length - 1] ?? '').toLowerCase().replace(/\W/g, ''))
  ) {
    words = words.slice(0, -1)
  }
  return words.join(' ').replace(/[,;:\-–—]+$/g, '')
}

const SHELL =
  /^(\$\s*)?(git|npm|npx|pnpm|yarn|pip3?|pipx|uv|cargo|brew|curl|wget|docker|mkdir|cd|cp|mv|claude|python3?|node|go|make|apt|sudo|bun|deno)\b/

export function shellLines(code: string): string[] | null {
  const lines = code
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0 || !lines.every((l) => SHELL.test(l) || /^#/.test(l))) return null
  return lines.map((l) => l.replace(/^\$\s*/, ''))
}

const SPOKEN_CMD =
  /\b(?:run|try|use|type|paste|execute)\s+((?:dig|nslookup|host|whois|curl|wget|npx|npm|pnpm|yarn|pip3?|pipx|uv|brew|cargo|git|docker|openssl|ping|traceroute)\b(?:\s+[^\s]+)*)/i
const SUBCOMMAND = /^(?:install|add|run|clone|pull|build|init|start|create|exec|test|i|dlx)$/i
const FIRST_ARG_TOOLS = /^(?:npx|bunx|uvx)$/i

/**
 * The command a sentence tells you to run ("Run dig +short TXT _dmarc.example.com today."): the
 * tool, then tokens that read as arguments (flags, record types, paths, URLs, names with dots or
 * digits, the subcommand after a package manager) up to the first plain word that is not one
 * ("today", "to"). Null when there is no argument at all.
 */
export function spokenCommand(text: string): string | null {
  const m = SPOKEN_CMD.exec(text)
  if (!m?.[1]) return null
  const out: string[] = []
  let ended = false
  for (const raw of m[1].split(/\s+/)) {
    if (ended) break
    const word = raw.replace(/[.,;:!?]+$/, '')
    if (!word) break
    if (out.length > 0) {
      const prev = out[out.length - 1]!
      const special = /[-+./:_=@~\d]/.test(word) || /^[A-Z]{2,}$/.test(word)
      const afterTool = out.length === 1 && (SUBCOMMAND.test(word) || FIRST_ARG_TOOLS.test(prev))
      const afterVerb = out.length === 2 && SUBCOMMAND.test(prev) && /^[\w@./-]+$/.test(word)
      const afterFlag = prev.startsWith('-') && /^[\w@./-]+$/.test(word)
      if (!(special || afterTool || afterVerb || afterFlag)) break
    }
    out.push(word)
    // A sentence end after a token ends the command.
    if (raw !== word && /[.!?]$/.test(raw)) ended = true
  }
  return out.length >= 2 ? out.join(' ') : null
}

export function versusPair(text: string): [string, string] | null {
  const m =
    /\b([A-Z][\w.+-]*(?: [A-Z][\w.+-]*)?)\s+(?:vs\.?|versus|over|beats|instead of)\s+([A-Z][\w.+-]*(?: [A-Z][\w.+-]*)?)/.exec(
      text,
    )
  return m && m[1] && m[2] ? [m[1], m[2]] : null
}

const FILLER = new Set(
  'the a an and or but so to of in on for with is are was were it its this that these those you your we our they their be been as at by from how what why when who which can will just also more most very'.split(
    ' ',
  ),
)

/** One to three words worth showing huge: a number, a Name, or the longest content words. */
export function salientPhrase(text: string, max = 3): string {
  const nums = findNumbers(text)
  const first = nums[0]
  if (first) return [first.raw, first.label.split(' ')[0]].filter(Boolean).join(' ')
  const tokens = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}$~+]+|[^\p{L}\p{N}%²³⁰-⁹]+$/gu, ''))
    .filter(Boolean)
  const scored = tokens.map((w, i) => {
    const lower = w.toLowerCase()
    let s = FILLER.has(lower) ? -5 : Math.min(w.length, 10) / 10
    if (/^[A-Z]/.test(w) && i > 0) s += 1.2
    if (/[A-Z].*[A-Z]|\d|-/.test(w)) s += 0.8
    return { w, i, s }
  })
  const best = [...scored].sort((a, b) => b.s - a.s || a.i - b.i)[0]
  if (!best) return text.split(' ').slice(0, max).join(' ')
  const out = [best.w]
  const next = scored[best.i + 1]
  const prev = scored[best.i - 1]
  if (next && next.s > 0 && out.length < max) out.push(next.w)
  else if (prev && prev.s > 0 && out.length < max) out.unshift(prev.w)
  return out.join(' ')
}

export function keyPhraseIn(text: string, min = 2, max = 4): string | null {
  const tokens = text.split(/\s+/).filter(Boolean)
  let best: { start: number; len: number; score: number } | null = null
  for (let i = 0; i < tokens.length; i += 1) {
    let len = 0
    let score = 0
    while (i + len < tokens.length && len < max) {
      const t = tokens[i + len] ?? ''
      if (FILLER.has(t.toLowerCase().replace(/\W/g, '')) && len === 0) break
      score += /^[A-Z]|\d|-/.test(t) ? 2 : 1
      len += 1
      if (/[.,;:!?]$/.test(t)) break
      if (len >= min && (!best || score > best.score)) best = { start: i, len, score }
    }
  }
  if (!best) return null
  return tokens
    .slice(best.start, best.start + best.len)
    .join(' ')
    .replace(/[.,;:!?]+$/, '')
}
