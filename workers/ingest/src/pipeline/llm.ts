import type { Logger } from '@reelset/core'
import {
  claudeCostUsd,
  createClaudeClient,
  DEFAULT_CLAUDE_MODEL,
  type ClaudeEffort,
} from './claude'
import type { LlmClient, LlmUsage } from './output'

export const LLM_PROVIDER = 'anthropic'

export type LlmEnv = {
  LLM_MODEL?: string
  LLM_EFFORT?: string
  CLAUDE_API_KEY?: string
}

export type LlmSelection = { model: string; client: LlmClient }

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Script generation runs on Claude only; Gemini is kept for embeddings. */
export function createLlm(env: LlmEnv, log: Logger): LlmSelection {
  if (!env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY is required for script generation')
  const model = env.LLM_MODEL || DEFAULT_CLAUDE_MODEL
  const effort =
    env.LLM_EFFORT && EFFORTS.has(env.LLM_EFFORT) ? (env.LLM_EFFORT as ClaudeEffort) : undefined
  return { model, client: createClaudeClient(env.CLAUDE_API_KEY, model, log, { effort }) }
}

export function llmCostFor(usage: LlmUsage): number {
  return claudeCostUsd(usage)
}
