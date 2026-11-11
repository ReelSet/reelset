import type { SpendCategory, SpendInput } from '@reelset/core'

// List prices (USD per MTok) for the spend guard only; LLM rates are claude-haiku-5-5, update with ASK_MODEL.
const LLM_RATES = { input: 0.1, output: 0.5 }
const LLM_LARGE_PROMPT_RATES = { input: 0.5, output: 2.5 }
const LARGE_PROMPT_TOKENS = 100_000
const EMBEDDING_USD_PER_MTOK = 0.15

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function llmCostUsd(inputTokens: number, outputTokens: number): number {
  const rates = inputTokens > LARGE_PROMPT_TOKENS ? LLM_LARGE_PROMPT_RATES : LLM_RATES
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

export function embeddingCostUsd(tokens: number): number {
  return (tokens * EMBEDDING_USD_PER_MTOK) / 1_000_000
}

export type AskSpendKind = Extract<SpendCategory, 'llm' | 'embedding'>

export function askSpendInput(kind: AskSpendKind, units: number, costUsd: number): SpendInput {
  return { category: 'ask', units, costUsd, meta: { kind } }
}
