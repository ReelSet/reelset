import type { SpendCategory, SpendInput } from '@reelset/core'

// Rough list prices used only for the spend guard; real billing lives with the provider.
const LLM_INPUT_USD_PER_MTOK = 0.3
const LLM_OUTPUT_USD_PER_MTOK = 2.5
const EMBEDDING_USD_PER_MTOK = 0.15

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function llmCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * LLM_INPUT_USD_PER_MTOK + outputTokens * LLM_OUTPUT_USD_PER_MTOK) / 1_000_000
}

export function embeddingCostUsd(tokens: number): number {
  return (tokens * EMBEDDING_USD_PER_MTOK) / 1_000_000
}

export type AskSpendKind = Extract<SpendCategory, 'llm' | 'embedding'>

export function askSpendInput(kind: AskSpendKind, units: number, costUsd: number): SpendInput {
  return { category: 'ask', units, costUsd, meta: { kind } }
}
