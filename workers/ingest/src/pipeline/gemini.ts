import { EMBEDDING_DIMENSIONS, reelScriptSchema, type Logger } from '@reelset/core'
import { z } from 'zod'
import { MAX_TLDR_CHARS } from '../config'
import { fetchJson } from '../http'
import {
  MAX_NARRATION_WORDS,
  clipHeadline,
  narrationWordCount,
  numberValues,
  repairBroll,
  repairShots,
} from './shots'
import type { Ledger } from './stat-labels'
import { asQuotaError } from './quota'
import type { GeneratedContent } from './safety'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiError'
  }
}

export type LlmUsage = { inputTokens: number; outputTokens: number }
export type LlmResult = { text: string; usage: LlmUsage }

// USD per 1M tokens for gemini-3.1-flash-lite. Estimates for spend tracking, not billing.
const PRICE_PER_M = { input: 0.25, output: 1.5, embedding: 0.15 }

export function llmCostUsd(usage: LlmUsage): number {
  return (
    (usage.inputTokens * PRICE_PER_M.input + usage.outputTokens * PRICE_PER_M.output) / 1_000_000
  )
}

export function approxTokens(texts: readonly string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4)
}

export function embeddingCostUsd(tokens: number): number {
  return (tokens * PRICE_PER_M.embedding) / 1_000_000
}

const generateResponseSchema = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        finishReason: z.string().nullish(),
        content: z
          .looseObject({ parts: z.array(z.looseObject({ text: z.string().nullish() })).nullish() })
          .nullish(),
      }),
    )
    .nullish(),
  promptFeedback: z.looseObject({ blockReason: z.string().nullish() }).nullish(),
  usageMetadata: z
    .looseObject({
      promptTokenCount: z.number().nullish(),
      candidatesTokenCount: z.number().nullish(),
    })
    .nullish(),
})

export function parseGenerateResponse(json: unknown): LlmResult {
  const parsed = generateResponseSchema.safeParse(json)
  if (!parsed.success) throw new GeminiError('unexpected generateContent response shape')
  const body = parsed.data
  if (body.promptFeedback?.blockReason) {
    throw new GeminiError(`prompt blocked: ${body.promptFeedback.blockReason}`)
  }
  const candidate = body.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) {
    throw new GeminiError(
      `empty model response (finishReason=${candidate?.finishReason ?? 'none'})`,
    )
  }
  return {
    text,
    usage: {
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    },
  }
}

export type LlmClient = {
  generate: (req: { system: string; user: string }) => Promise<LlmResult>
}

export function createLlmClient(apiKey: string, model: string, log: Logger): LlmClient {
  return {
    generate: async ({ system, user }) => {
      const json = await geminiJson(`${BASE}/models/${model}:generateContent`, log, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        }),
        timeoutMs: 60_000,
        hostIntervalMs: 0,
      })
      return parseGenerateResponse(json)
    },
  }
}

async function geminiJson(
  url: string,
  log: Logger,
  options: Parameters<typeof fetchJson>[2],
): Promise<unknown> {
  try {
    return await fetchJson(url, log, options)
  } catch (err) {
    throw asQuotaError(err)
  }
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
 * Gemini regularly overshoots the hard length limits by a few characters. Rejecting those wastes
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
  if (Array.isArray(script.beats)) {
    const beats: unknown[] = script.beats.slice(0, 6)
    script.beats = beats
    const labelLedger: Ledger = new Map()
    for (const beat of beats) {
      if (!isObj(beat)) continue
      clip(beat, 'text', 220)
      repairShots(beat, factNumbers, labelLedger)
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

export function parseModelOutput(
  text: string,
  allowedChunkIds?: ReadonlySet<string>,
  facts = '',
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
  const words = narrationWordCount(parsed.data.script)
  if (words > MAX_NARRATION_WORDS) {
    return {
      ok: false,
      reason: `narration is ${words} words, over ${MAX_NARRATION_WORDS}; write 110 to 125 words total`,
    }
  }
  const topics = [...new Set(parsed.data.topics.map((t) => t.toLowerCase()))]
  return { ok: true, value: { ...parsed.data, topics } }
}

export function normalizeVector(values: readonly number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
  return norm === 0 ? [...values] : values.map((v) => v / norm)
}

const embedResponseSchema = z.looseObject({
  embeddings: z.array(z.looseObject({ values: z.array(z.number()) })),
})

export function parseEmbedResponse(json: unknown, expected: number): number[][] {
  const parsed = embedResponseSchema.safeParse(json)
  if (!parsed.success) throw new GeminiError('unexpected batchEmbedContents response shape')
  const vectors = parsed.data.embeddings.map((e) => e.values)
  if (vectors.length !== expected) {
    throw new GeminiError(`expected ${expected} embeddings, got ${vectors.length}`)
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new GeminiError(`expected ${EMBEDDING_DIMENSIONS} dimensions, got ${v.length}`)
    }
  }
  return vectors.map(normalizeVector)
}

export type Embedder = {
  embed: (texts: readonly string[]) => Promise<number[][]>
}

export function createEmbedder(apiKey: string, model: string, log: Logger): Embedder {
  return {
    embed: async (texts) => {
      if (texts.length === 0) return []
      const json = await geminiJson(`${BASE}/models/${model}:batchEmbedContents`, log, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
        timeoutMs: 60_000,
        hostIntervalMs: 0,
      })
      return parseEmbedResponse(json, texts.length)
    },
  }
}
