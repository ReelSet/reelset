import type { AskModelConfig } from '@/lib/ask/claude'
import type { GeminiEmbeddingConfig } from '@/lib/ask/gemini'

const DEFAULT_ASK_MODEL = 'claude-haiku-5-5'
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

export function askModelConfig(): AskModelConfig {
  return {
    apiKey: requireEnv('CLAUDE_API_KEY'),
    model: process.env.ASK_MODEL || DEFAULT_ASK_MODEL,
  }
}
