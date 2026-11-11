import type { ClaudeModel } from '@reelset/core'
import type { AskModelConfig } from '@/lib/ask/claude'
import type { GeminiEmbeddingConfig } from '@/lib/ask/gemini'

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing env var ${name}`)
  return value
}

export function mediaBaseUrl(): string {
  return requireEnv('MEDIA_PUBLIC_BASE_URL')
}

// Gemini serves only Ask question embeddings; vectors must match the 768-dim ingest embeddings.
export function geminiEmbeddingConfig(): GeminiEmbeddingConfig {
  return {
    apiKey: requireEnv('GEMINI_API_KEY'),
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  }
}

// The model is an admin setting (app_setting ask_model); only the key comes from env.
export function askModelConfig(model: ClaudeModel): AskModelConfig {
  return { apiKey: requireEnv('CLAUDE_API_KEY'), model }
}
