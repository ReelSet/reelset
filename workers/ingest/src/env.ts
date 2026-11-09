export type IngestItemMessage = { itemId: string; attempt: number }
export type RenderJobMessage = { itemId: string; attempt: number }

export interface Env {
  HYPERDRIVE: Hyperdrive
  INGEST_ITEMS: Queue<IngestItemMessage>
  RENDER_JOBS: Queue<RenderJobMessage>
  RENDER: Fetcher
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string
  GEMINI_EMBEDDING_MODEL?: string
  GITHUB_TOKEN?: string
  FIRECRAWL_API_KEY?: string
  ALERT_WEBHOOK_URL?: string
  SELFCHECK_TOKEN?: string
  LOG_LEVEL?: string
}

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'
