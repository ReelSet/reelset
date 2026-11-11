import { reelScriptSchema, spokenChars } from '@reelset/core'
import { z } from 'zod'
import { MAX_TLDR_CHARS } from '../config'
import {
  MAX_NARRATION_WORDS,
  clipHeadline,
  narrationWordCount,
  numberValues,
  repairBroll,
  repairShots,
} from './shots'
import type { Ledger } from './stat-labels'
import type { GeneratedContent } from './safety'

/** inputTokens excludes cache tokens when the provider reports them separately. */
export type LlmUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
export type LlmResult = { text: string; usage: LlmUsage }

/** An image sent to the model with the prompt, already downloaded. */
export type LlmImage = { mime: string; base64: string }

export type LlmRequest = { system: string; user: string; images?: readonly LlmImage[] }

export type LlmClient = {
  generate: (req: LlmRequest) => Promise<LlmResult>
}

const outputSchema = z.object({
  tldr: z.string().trim().min(1).max(MAX_TLDR_CHARS),
  topics: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  script: reelScriptSchema,
})

const ELLIPSIS = '\u2026'

/** Cuts at a word boundary so the result is at most max characters, ellipsis included. */
export function truncateAtWord(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const room = t.slice(0, max - 1)
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace >= max * 0.5 ? room.slice(0, lastSpace) : room
  return cut.replace(/[\s,;:\-\u2013\u2014([{]+$/, '') + ELLIPSIS
}

function cutCode(code: string, max: number): string {
  if (code.length <= max) return code
  const head = code.slice(0, max)
  const lastNewline = head.lastIndexOf('\n')
  return lastNewline >= max * 0.5 ? head.slice(0, lastNewline) : head
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function clip(o: Obj, key: string, max: number): void {
  const v = o[key]
  if (typeof v === 'string') o[key] = truncateAtWord(v, max)
}

/**
 * Models regularly overshoot the hard length limits by a few characters. Rejecting those wastes
 * the LLM spend and the daily reel slot, so trim at word boundaries and fill a missing quote
 * attribution before strict validation. Anything structurally wrong is still rejected.
 */
export function dropUnknownChunkIds(claims: unknown[], allowed: ReadonlySet<string>): unknown[] {
  const byLower = new Map([...allowed].map((id) => [id.toLowerCase(), id]))
  const kept: unknown[] = []
  for (const claim of claims) {
    if (!isObj(claim) || !Array.isArray(claim.chunkIds)) continue
    const ids = claim.chunkIds
      .map((id) => (typeof id === 'string' ? byLower.get(id.trim().toLowerCase()) : undefined))
      .filter((id): id is string => id !== undefined)
    if (ids.length === 0) continue
    claim.chunkIds = [...new Set(ids)]
    kept.push(claim)
  }
  return kept
}

export function repairModelOutput(
  json: unknown,
  allowedChunkIds?: ReadonlySet<string>,
  facts = '',
): unknown {
  if (!isObj(json)) return json
  clip(json, 'tldr', MAX_TLDR_CHARS)
  if (Array.isArray(json.topics)) {
    json.topics = json.topics
      .filter((t): t is string => typeof t === 'string')
      .map((t) => truncateAtWord(t, 40))
      .filter(Boolean)
      .slice(0, 8)
  }
  const script = json.script
  if (!isObj(script)) return json
  clip(script, 'hook', 120)
  clip(script, 'outro', 120)
  const headline = clipHeadline(script.headline)
  if (headline) script.headline = headline
  else delete script.headline
  const factNumbers = numberValues(facts)
  if (Array.isArray(script.claims)) {
    for (const claim of script.claims) if (isObj(claim)) clip(claim, 'text', 220)
    if (allowedChunkIds) script.claims = dropUnknownChunkIds(script.claims, allowedChunkIds)
  }
  const claims = Array.isArray(script.claims)
    ? script.claims.flatMap((c) => (isObj(c) && typeof c.text === 'string' ? [c.text] : []))
    : []
  if (Array.isArray(script.beats)) {
    const beats: unknown[] = script.beats.slice(0, 6)
    script.beats = beats
    const labelLedger: Ledger = new Map()
    for (const beat of beats) {
      if (!isObj(beat)) continue
      clip(beat, 'text', 220)
      repairShots(beat, factNumbers, labelLedger, { sourceText: facts, claims })
      repairBroll(beat)
      const v = beat.visual
      if (!isObj(v)) continue
      if (v.type === 'title') {
        clip(v, 'title', 90)
        clip(v, 'subtitle', 120)
      } else if (v.type === 'code') {
        if (typeof v.code === 'string') v.code = cutCode(v.code, 600)
        clip(v, 'language', 24)
      } else if (v.type === 'stat') {
        clip(v, 'label', 60)
        clip(v, 'value', 24)
      } else if (v.type === 'quote') {
        clip(v, 'text', 220)
        if (typeof v.attribution !== 'string' || !v.attribution.trim()) {
          v.attribution = 'From the source'
        } else {
          clip(v, 'attribution', 80)
        }
      }
    }
  }
  return json
}

export type ParsedOutput = { ok: true; value: GeneratedContent } | { ok: false; reason: string }

export type NarrationLimits = { min?: number; max?: number; maxSpokenChars?: number }

function narrationRejection(
  script: { hook: string; beats: readonly { text: string }[]; outro: string },
  limits: NarrationLimits,
): string | null {
  const words = narrationWordCount(script)
  const max = limits.max ?? MAX_NARRATION_WORDS
  const range = limits.min !== undefined ? `${limits.min} to ${max}` : `at most ${max}`
  if (words > max) return `narration is ${words} words, over ${max}; write ${range} words total`
  if (limits.min !== undefined && words < limits.min) {
    return `narration is ${words} words, under ${limits.min}; write ${range} words total`
  }
  if (limits.maxSpokenChars === undefined) return null
  const spoken = spokenChars(
    [script.hook, ...script.beats.map((b) => b.text), script.outro].join(' '),
  )
  if (spoken <= limits.maxSpokenChars) return null
  return `narration takes too long to say (${spoken} spoken characters, over ${limits.maxSpokenChars}); long numbers are read digit by digit, so say them with at most 3 significant digits ("about 0.998" or "99.8 percent") and cut words`
}

export function parseModelOutput(
  text: string,
  allowedChunkIds?: ReadonlySet<string>,
  facts = '',
  limits: NarrationLimits = {},
): ParsedOutput {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let json: unknown
  try {
    json = JSON.parse(stripped)
  } catch {
    return { ok: false, reason: 'response was not valid JSON' }
  }
  const parsed = outputSchema.safeParse(repairModelOutput(json, allowedChunkIds, facts))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, reason: `JSON did not match the required schema: ${issues}` }
  }
  const reason = narrationRejection(parsed.data.script, limits)
  if (reason) return { ok: false, reason }
  const topics = [...new Set(parsed.data.topics.map((t) => t.toLowerCase()))]
  return { ok: true, value: { ...parsed.data, topics } }
}
