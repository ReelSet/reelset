import type { Logger, ReelScript } from '@reelset/core'
import { RenderJobError } from './errors'

export const AURA_MODEL = '@cf/deepgram/aura-2-en'
export const NOVA_MODEL = '@cf/deepgram/nova-3'
export const AURA_USD_PER_CHAR = 0.03 / 1000
export const NOVA_USD_PER_SECOND = 0.0052 / 60
export const AURA_CHUNK_CHARS = 1500
export const AURA_AI_ATTEMPTS = 2
export const KOKORO_VOICE = 'af_heart'
export const MAX_NARRATION_SECONDS = 98
export const SHORTEN_MARGIN_SECONDS = 5
export const MAX_SHORTEN_ATTEMPTS = 2
const MIN_BEATS_AFTER_SHORTEN = 3
const SPOKEN_SIGNIFICANT_DIGITS = 3
export const AURA_SPEAKERS = [
  'amalthea',
  'andromeda',
  'apollo',
  'arcas',
  'aries',
  'asteria',
  'athena',
  'atlas',
  'aurora',
  'callista',
  'cora',
  'cordelia',
  'delia',
  'draco',
  'electra',
  'harmonia',
  'helena',
  'hera',
  'hermes',
  'hyperion',
  'iris',
  'janus',
  'juno',
  'jupiter',
  'luna',
  'mars',
  'minerva',
  'neptune',
  'odysseus',
  'ophelia',
  'orion',
  'orpheus',
  'pandora',
  'phoebe',
  'pluto',
  'saturn',
  'thalia',
  'theia',
  'vesta',
  'zeus',
] as const

const errorFields = (err: unknown) => ({
  err: err instanceof Error ? { name: err.name, message: err.message } : String(err),
})

export type TtsProvider = 'edge' | 'aura2' | 'kokoro'
export type FallbackEngine = 'kokoro' | 'edge'
export type TimedWord = { text: string; start: number; end: number }
export type SpokenWord = { word: string; start: number; end: number }
export type AiLike = { run(model: string, input: Record<string, unknown>): Promise<unknown> }
export type Narration = {
  audio: Uint8Array
  words: TimedWord[]
  chars: number
  audioSeconds: number
  costUsd: number
  alignment: AlignMethod
  spoken: SpokenWord[]
}
export type AlignMethod = 'aligned' | 'proportional'

export function narrationText(script: ReelScript): string {
  return [script.hook, ...script.beats.map((b) => b.text), script.outro].join(' ')
}

/** The render-key voice: switching provider or speaker changes it, so reels re-render. */
export function effectiveVoice(provider: TtsProvider, speaker: string, edgeVoice: string): string {
  if (provider === 'aura2') return `aura2-${speaker}`
  return provider === 'kokoro' ? `kokoro-${KOKORO_VOICE}` : edgeVoice
}

/** Aura needs the AI binding; without it the chain starts at Kokoro. */
export function selectProvider(provider: TtsProvider, ai: AiLike | undefined): TtsProvider {
  return provider === 'aura2' && !ai ? 'kokoro' : provider
}

/** Engine the container tries first when the worker supplies no narration; edge-tts is always last. */
export function fallbackEngineFor(provider: TtsProvider): FallbackEngine {
  return provider === 'edge' ? 'edge' : 'kokoro'
}

export function chunkText(text: string, maxChars = AURA_CHUNK_CHARS): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => splitLong(s, maxChars))
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > maxChars) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitLong(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence]
  const parts: string[] = []
  let current = ''
  for (const word of sentence.split(/\s+/)) {
    if (current && current.length + 1 + word.length > maxChars) {
      parts.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) parts.push(current)
  return parts
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function weights(tokens: string[]): number[] {
  return tokens.map((t) => t.length + 1)
}

function spread(tokens: string[], start: number, end: number): TimedWord[] {
  const w = weights(tokens)
  const total = w.reduce((a, b) => a + b, 0)
  const span = Math.max(0, end - start)
  let cursor = start
  return tokens.map((text, i) => {
    const next = cursor + (span * w[i]!) / total
    const word = { text, start: cursor, end: next }
    cursor = next
    return word
  })
}

/** Longest common subsequence of equal normalized words; returns [tokenIndex, spokenIndex] pairs. */
function anchors(tokenNorm: string[], spokenNorm: string[]): [number, number][] {
  const n = tokenNorm.length
  const m = spokenNorm.length
  const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] =
        tokenNorm[i] && tokenNorm[i] === spokenNorm[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (tokenNorm[i] && tokenNorm[i] === spokenNorm[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/**
 * Maps the script's own tokens onto ASR word times. Words the ASR heard identically are anchors;
 * everything between two anchors (numbers read aloud, hyphenated terms, ASR slips) shares the ASR
 * time window of that gap by character weight. Too few anchors falls back to even per-character timing.
 */
export function alignWords(
  text: string,
  spoken: SpokenWord[],
  totalSeconds: number,
): { words: TimedWord[]; method: AlignMethod; matched: number } {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { words: [], method: 'proportional', matched: 0 }
  const heard = spoken.filter((w) => w.end >= w.start)
  const fallbackStart = heard.length ? heard[0]!.start : 0
  const fallbackEnd = heard.length ? Math.max(heard.at(-1)!.end, fallbackStart) : totalSeconds
  const proportional = () => ({
    words: spread(tokens, fallbackStart, fallbackEnd),
    method: 'proportional' as const,
    matched: 0,
  })
  if (heard.length === 0) return proportional()

  const pairs = anchors(
    tokens.map(normalize),
    heard.map((w) => normalize(w.word)),
  )
  const meaningful = tokens.filter((t) => normalize(t)).length
  if (pairs.length < Math.max(1, meaningful * 0.5)) return proportional()

  const out: TimedWord[] = []
  const fill = (ti0: number, ti1: number, si0: number, si1: number, lo: number, hi: number) => {
    if (ti1 <= ti0) return
    const hasSpoken = si1 > si0
    const start = hasSpoken ? heard[si0]!.start : lo
    const end = hasSpoken ? heard[si1 - 1]!.end : hi
    out.push(...spread(tokens.slice(ti0, ti1), Math.max(start, lo), Math.max(end, start, lo)))
  }
  let ti = 0
  let si = 0
  let cursor = 0
  for (const [ai, aj] of pairs) {
    fill(ti, ai, si, aj, cursor, heard[aj]!.start)
    const w = heard[aj]!
    const start = Math.max(w.start, cursor)
    out.push({ text: tokens[ai]!, start, end: Math.max(w.end, start) })
    cursor = out.at(-1)!.end
    ti = ai + 1
    si = aj + 1
  }
  fill(ti, tokens.length, si, heard.length, cursor, Math.max(totalSeconds, cursor))
  return { words: out, method: 'aligned', matched: pairs.length }
}

async function toBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof Uint8Array) return result
  if (result instanceof ArrayBuffer) return new Uint8Array(result)
  if (result instanceof ReadableStream)
    return new Uint8Array(await new Response(result).arrayBuffer())
  if (
    result &&
    typeof result === 'object' &&
    'audio' in result &&
    typeof result.audio === 'string'
  ) {
    return Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0))
  }
  throw new Error('unexpected aura output')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function parseSpokenWords(result: unknown): SpokenWord[] {
  const channels = (
    result as { results?: { channels?: { alternatives?: { words?: unknown[] }[] }[] } }
  )?.results?.channels
  const words = channels?.[0]?.alternatives?.[0]?.words ?? []
  return words.flatMap((w) => {
    const { word, punctuated_word: punctuated, start, end } = w as Record<string, unknown>
    const text =
      typeof word === 'string' ? word : typeof punctuated === 'string' ? punctuated : null
    return text !== null && typeof start === 'number' && typeof end === 'number'
      ? [{ word: text, start, end }]
      : []
  })
}

async function withRetries<T>(fn: () => Promise<T>, attempts: number, log: Logger): Promise<T> {
  let last: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      log.warn({ attempt: i, ...errorFields(err) }, 'workers ai call failed')
    }
  }
  throw last
}

export async function synthesizeSpeech(
  ai: AiLike,
  text: string,
  speaker: string,
  log: Logger,
): Promise<{ audio: Uint8Array; spoken: SpokenWord[]; audioSeconds: number }> {
  const parts: Uint8Array[] = []
  for (const chunk of chunkText(text)) {
    parts.push(
      await withRetries(
        async () => toBytes(await ai.run(AURA_MODEL, { text: chunk, speaker, encoding: 'mp3' })),
        AURA_AI_ATTEMPTS,
        log,
      ),
    )
  }
  const audio = concat(parts)
  const transcript = await withRetries(
    () =>
      ai.run(NOVA_MODEL, {
        audio: { body: new Blob([audio]).stream(), contentType: 'audio/mpeg' },
        punctuate: false,
        smart_format: false,
        numerals: false,
      }),
    AURA_AI_ATTEMPTS,
    log,
  )
  const spoken = parseSpokenWords(transcript)
  return { audio, spoken, audioSeconds: spoken.at(-1)?.end ?? 0 }
}

/** Generates narration audio with word timings via Workers AI; any failure, including unusable alignment, throws tts_unavailable. */
export async function generateNarration(
  ai: AiLike,
  text: string,
  speaker: string,
  log: Logger,
): Promise<Narration> {
  let generated: Awaited<ReturnType<typeof synthesizeSpeech>>
  try {
    generated = await synthesizeSpeech(ai, text, speaker, log)
  } catch (err) {
    log.error({ speaker, ...errorFields(err) }, 'aura-2 narration failed')
    throw new RenderJobError('tts_unavailable', 'workers ai tts failed')
  }
  if (generated.audio.length === 0) throw new RenderJobError('tts_unavailable', 'empty aura audio')
  const aligned = alignWords(text, generated.spoken, generated.audioSeconds)
  if (aligned.method === 'proportional') {
    log.warn({ speaker, words: generated.spoken.length }, 'aura-2 word alignment too poor')
    throw new RenderJobError('tts_unavailable', 'aura word alignment too poor')
  }
  const chars = text.length
  const audioSeconds = generated.audioSeconds
  log.info(
    { speaker, chars, audioSeconds, alignment: aligned.method, matched: aligned.matched },
    'aura-2 narration ready',
  )
  return {
    audio: generated.audio,
    words: aligned.words,
    chars,
    audioSeconds,
    costUsd: Number((chars * AURA_USD_PER_CHAR + audioSeconds * NOVA_USD_PER_SECOND).toFixed(6)),
    alignment: aligned.method,
    spoken: generated.spoken,
  }
}

export function wordsToJson(words: TimedWord[]) {
  return words.map((w) => ({
    text: w.text,
    start: Number(w.start.toFixed(3)),
    end: Number(w.end.toFixed(3)),
  }))
}

export function audioToBase64(audio: Uint8Array): string {
  return toBase64(audio)
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

function cueText(cue: string): string {
  return cue
    .replace(/#\d+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

const LONG_DECIMAL = /\d+\.\d{4,}/g

function speakDecimal(match: string): string {
  const rounded = Number(Number(match).toPrecision(SPOKEN_SIGNIFICANT_DIGITS))
  const text = String(rounded)
  return Number.isFinite(rounded) && !text.includes('e') ? text : match
}

/** Rewrites decimals with 4+ fraction digits to 3 significant digits: Aura reads long digit strings one digit at a time. */
export function speakableNumbers(script: ReelScript): ReelScript {
  const fix = (text: string) => text.replace(LONG_DECIMAL, speakDecimal)
  return {
    ...script,
    hook: fix(script.hook),
    outro: fix(script.outro),
    beats: script.beats.map((beat) => ({
      ...beat,
      text: fix(beat.text),
      ...(beat.shots ? { shots: beat.shots.map((shot) => ({ ...shot, at: fix(shot.at) })) } : {}),
    })),
  }
}

type Sentences = string[]

function longestCuttable(sentences: Sentences[]): number {
  let pick = -1
  let best = 0
  sentences.forEach((s, i) => {
    const w = wordCount(s.join(' '))
    if (s.length >= 2 && w > best) {
      best = w
      pick = i
    }
  })
  return pick
}

function longestBeatAfterFirst(sentences: Sentences[]): number {
  let pick = -1
  let best = 0
  sentences.forEach((s, i) => {
    const w = wordCount(s.join(' '))
    if (i > 0 && w > best) {
      best = w
      pick = i
    }
  })
  return pick
}

/**
 * Cuts the narration to about `ratio` of its length: trailing sentences of the longest multi-sentence
 * beats first, then whole beats (never the first, never below 3 beats). Hook and outro are untouched.
 * Returns null if nothing can be cut.
 */
export function shortenScript(script: ReelScript, ratio: number): ReelScript | null {
  const total = wordCount(narrationText(script))
  const target = Math.floor(total * Math.min(0.95, Math.max(0.3, ratio)))
  const sentences: Sentences[] = script.beats.map((b) =>
    b.text
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean),
  )
  const kept = script.beats.map((_, i) => i)
  let words = total
  let changed = false
  while (words > target) {
    const pick = longestCuttable(sentences)
    if (pick >= 0) {
      words -= wordCount(sentences[pick]!.pop()!)
    } else if (sentences.length > MIN_BEATS_AFTER_SHORTEN) {
      const drop = longestBeatAfterFirst(sentences)
      words -= wordCount(sentences[drop]!.join(' '))
      sentences.splice(drop, 1)
      kept.splice(drop, 1)
    } else break
    changed = true
  }
  if (!changed) return null
  return {
    ...script,
    beats: kept.map((original, i) => {
      const beat = script.beats[original]!
      const text = sentences[i]!.join(' ')
      const spoken = text.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const shots = beat.shots?.filter((s) => spoken.includes(cueText(s.at)))
      return { ...beat, text, ...(shots ? { shots } : {}) }
    }),
  }
}
