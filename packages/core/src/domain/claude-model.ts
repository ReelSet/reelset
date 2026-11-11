import { z } from 'zod'

export const CLAUDE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const
export const claudeModelSchema = z.enum(CLAUDE_MODELS)
export type ClaudeModel = z.infer<typeof claudeModelSchema>
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'claude-haiku-5-5'

export const CLAUDE_EFFORTS = ['low', 'medium', 'high'] as const
export const claudeEffortSchema = z.enum(CLAUDE_EFFORTS)
export type ClaudeEffort = z.infer<typeof claudeEffortSchema>

export type ClaudeTokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type ClaudeRateCard = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

type ClaudePricing = {
  standard: ClaudeRateCard
  longPrompt?: { aboveTokens: number; rates: ClaudeRateCard }
}

const CACHE_WRITE_5M_MULTIPLIER = 1.25
const TOKENS_PER_PRICE_UNIT = 1_000_000

function rateCard(input: number, output: number, cacheRead: number): ClaudeRateCard {
  return { input, output, cacheRead, cacheWrite: input * CACHE_WRITE_5M_MULTIPLIER }
}

// Anthropic first-party list prices in USD per MTok, as of 2026-11; update when they change.
export const CLAUDE_PRICING: Record<ClaudeModel, ClaudePricing> = {
  'claude-haiku-5-5': {
    standard: rateCard(0.1, 0.5, 0.01),
    longPrompt: { aboveTokens: 100_000, rates: rateCard(0.5, 2.5, 0.05) },
  },
  'claude-sonnet-5-5': { standard: rateCard(2, 10, 0.1) },
  'claude-opus-5-5': { standard: rateCard(4, 20, 0.2) },
}

/** Rate card for a prompt of this many tokens (input plus cache reads and writes). */
export function claudeRateCard(model: ClaudeModel, promptTokens: number): ClaudeRateCard {
  const { standard, longPrompt } = CLAUDE_PRICING[model]
  return longPrompt && promptTokens > longPrompt.aboveTokens ? longPrompt.rates : standard
}

/** List-price USD cost of one call, cache tokens included (5-minute cache writes). */
export function claudeCostUsd(model: ClaudeModel, usage: ClaudeTokenUsage): number {
  const read = usage.cacheReadTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  const rates = claudeRateCard(model, usage.inputTokens + read + write)
  const usdTimesMillion =
    usage.inputTokens * rates.input +
    read * rates.cacheRead +
    write * rates.cacheWrite +
    usage.outputTokens * rates.output
  return usdTimesMillion / TOKENS_PER_PRICE_UNIT
}
