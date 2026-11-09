// Mirror of workers/render/container/remotion/src/lib/labels.ts: a big number's label must come from
// the words next to that number in the narration, and a label is never reused for another number.
const sentences = (text: string): string[] =>
  (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean)

const NUM = /\d[\d,]*(?:\.\d+)?/g
const STOP = new Set(
  'the a an and or but so to of in on for with is are was was were be been by at as it its this that these those from than then into over under up down we our their his her which who whom while when where how what why not no can will would could should may might has have had do does did also just more most very'.split(
    ' ',
  ),
)
const UNIT_WORDS = new Set(['percent', 'billion', 'million', 'thousand', 'x', 'k', 'm', 'b'])
const WINDOW = 6

export type Mention = { value: number; start: number; end: number }

/** Numeric value of a displayed stat ("52.8%", "$1.2M", "12k", "3x"), or null. */
export function valueOf(raw: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?([kKmMbB]|billion|million|thousand)?/.exec(raw)
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

export function mentions(text: string): Mention[] {
  const out: Mention[] = []
  for (const m of text.matchAll(NUM)) {
    const start = m.index ?? 0
    if (/[A-Za-z^_]$/.test(text.slice(Math.max(0, start - 1), start))) continue
    const after = /^\s?([kKmMbB]\b|billion|million|thousand)/.exec(text.slice(start + m[0].length))
    const v = valueOf(`${m[0]}${after ? after[1] : ''}`)
    if (v === null) continue
    out.push({ value: v, start, end: start + m[0].length + (after ? after[0].length : 0) })
  }
  return out
}

const norm = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}^²³-]/gu, '')
    .replace(/(?<=\p{L}{3})s$/u, '')

type Tok = { text: string; start: number; end: number }

function tokens(text: string): Tok[] {
  return [...text.matchAll(/\S+/g)].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))
}

const isContent = (w: string) => {
  const n = norm(w)
  return n.length > 0 && !STOP.has(n) && !UNIT_WORDS.has(n) && !/^[\d.,%$~+]+$/.test(n)
}

/** Content words within `WINDOW` tokens of the mention, normalized. */
function windowWords(text: string, at: Mention): Set<string> {
  const toks = tokens(text)
  const i = toks.findIndex((t) => t.end > at.start)
  const j = toks.findIndex((t) => t.end >= at.end)
  const lo = Math.max(0, i - WINDOW)
  const hi = Math.min(toks.length, (j < 0 ? toks.length : j + 1) + WINDOW)
  return new Set(
    toks
      .slice(lo, hi)
      .filter((t) => isContent(t.text))
      .map((t) => norm(t.text)),
  )
}

export function labelIsNear(label: string, text: string, at: Mention): boolean {
  const words = label.split(/\s+/).filter(isContent).map(norm)
  if (words.length === 0) return false
  const near = windowWords(text, at)
  return words.every((w) => near.has(w))
}

function clean(w: string): string {
  return w.replace(/^[("'\[]+|[)"'\],.;:!?]+$/g, '')
}

/** Up to three content words that follow the number, else the ones that precede it. */
export function contextLabel(sentence: string, at: Mention, max = 3): string {
  const toks = tokens(sentence)
  const after = toks.filter((t) => t.start >= at.end)
  const out: string[] = []
  for (const t of after) {
    if (!isContent(t.text)) break
    out.push(clean(t.text))
    if (out.length >= max || /[.,;:!?]$/.test(t.text)) break
  }
  if (out.length > 0) return out.join(' ')
  const before = toks.filter((t) => t.end <= at.start).reverse()
  for (const t of before) {
    if (!isContent(t.text)) {
      if (out.length > 0) break
      continue
    }
    out.unshift(clean(t.text))
    if (out.length >= max) break
  }
  return out.join(' ')
}

export type Ledger = Map<string, number>

export type Grounded = { label: string; grounded: boolean }

const keyOf = (label: string) => label.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Label for `value` given the narration `text` it is spoken in.
 * - kept when its words sit within a few words of that number in the text;
 * - otherwise replaced by the words next to the number;
 * - a label already used for a different number in this reel is replaced the same way, then dropped.
 * A number that is not in the text (item facts) keeps its label unless it collides.
 */
export function groundLabel(value: string, label: string, text: string, ledger: Ledger): Grounded {
  const v = valueOf(value)
  const found = v === null ? [] : mentions(text).filter((m) => m.value === v)
  const candidates: { label: string; grounded: boolean }[] = []
  if (found.length === 0) {
    candidates.push({ label: label.trim(), grounded: true })
  } else {
    if (found.some((m) => labelIsNear(label, text, m)))
      candidates.push({ label: label.trim(), grounded: true })
    const sent = sentences(text).find((s) => mentions(s).some((m) => m.value === v)) ?? text
    const at = mentions(sent).find((m) => m.value === v)
    if (at) candidates.push({ label: contextLabel(sent, at), grounded: true })
  }
  for (const c of candidates) {
    const k = keyOf(c.label)
    if (!k) continue
    const prior = ledger.get(k)
    if (prior !== undefined && v !== null && prior !== v) continue
    if (v !== null) ledger.set(k, v)
    return c
  }
  return { label: '', grounded: false }
}
