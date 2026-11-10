import type { Logger } from '@reelset/core'
import { DEFAULT_GEMINI_MODEL } from '../env'
import {
  claudeCostUsd,
  createClaudeClient,
  DEFAULT_CLAUDE_MODEL,
  type ClaudeEffort,
} from './claude'
import {
  createLlmClient,
  llmCostUsd as geminiCostUsd,
  type LlmClient,
  type LlmUsage,
} from './gemini'

export type LlmProvider = 'anthropic' | 'gemini'

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'gemini'

export function parseLlmProvider(value: string | undefined): LlmProvider {
  if (!value) return DEFAULT_LLM_PROVIDER
  if (value === 'anthropic' || value === 'gemini') return value
  throw new Error(`LLM_PROVIDER must be 'anthropic' or 'gemini', got '${value}'`)
}

export type LlmEnv = {
  LLM_PROVIDER?: string
  LLM_MODEL?: string
  LLM_EFFORT?: string
  CLAUDE_API_KEY?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
}

export type LlmSelection = { provider: LlmProvider; model: string; client: LlmClient }

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export function createLlm(env: LlmEnv, log: Logger): LlmSelection {
  const provider = parseLlmProvider(env.LLM_PROVIDER)
  if (provider === 'anthropic') {
    if (!env.CLAUDE_API_KEY)
      throw new Error('CLAUDE_API_KEY is required when LLM_PROVIDER=anthropic')
    const model = env.LLM_MODEL || DEFAULT_CLAUDE_MODEL
    const effort =
      env.LLM_EFFORT && EFFORTS.has(env.LLM_EFFORT) ? (env.LLM_EFFORT as ClaudeEffort) : undefined
    return {
      provider,
      model,
      client: createClaudeClient(env.CLAUDE_API_KEY, model, log, { effort }),
    }
  }
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini')
  const model = env.LLM_MODEL || env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  return { provider, model, client: createLlmClient(env.GEMINI_API_KEY, model, log) }
}

export function llmCostFor(provider: LlmProvider, usage: LlmUsage): number {
  return provider === 'anthropic' ? claudeCostUsd(usage) : geminiCostUsd(usage)
}
