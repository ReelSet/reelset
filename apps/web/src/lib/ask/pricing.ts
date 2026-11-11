import { claudeCostUsd, type ClaudeModel, type SpendCategory, type SpendInput } from '@reelset/core'

// gemini-embedding-001 list price for the spend guard; Claude prices live in the core table.
const EMBEDDING_USD_PER_MTOK = 0.15

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function llmCostUsd(model: ClaudeModel, inputTokens: number, outputTokens: number): number {
  return claudeCostUsd(model, { inputTokens, outputTokens })
}

export function embeddingCostUsd(tokens: number): number {
  return (tokens * EMBEDDING_USD_PER_MTOK) / 1_000_000
}

export type AskSpendKind = Extract<SpendCategory, 'llm' | 'embedding'>

export function askSpendInput(
  kind: AskSpendKind,
  units: number,
  costUsd: number,
  model?: ClaudeModel,
): SpendInput {
  return { category: 'ask', units, costUsd, meta: model ? { kind, model } : { kind } }
}
