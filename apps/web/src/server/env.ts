export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing env var ${name}`)
  return value
}

export function mediaBaseUrl(): string {
  return requireEnv('MEDIA_PUBLIC_BASE_URL')
}

export type GeminiConfig = { apiKey: string; model: string; embeddingModel: string }

export function geminiConfig(): GeminiConfig {
  return {
    apiKey: requireEnv('GEMINI_API_KEY'),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
  }
}
