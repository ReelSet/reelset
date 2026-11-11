export type IngestItemMessage = { itemId: string; attempt: number }
export type RenderJobMessage = { itemId: string; attempt: number }

export interface Env {
  HYPERDRIVE: Hyperdrive
  INGEST_ITEMS: Queue<IngestItemMessage>
  RENDER_JOBS: Queue<RenderJobMessage>
  RENDER: Fetcher
  GEMINI_API_KEY: string
  CLAUDE_API_KEY?: string
  LLM_MODEL?: string
  LLM_EFFORT?: string
  GEMINI_EMBEDDING_MODEL?: string
  GITHUB_TOKEN?: string
  FIRECRAWL_API_KEY?: string
  ALERT_WEBHOOK_URL?: string
  SELFCHECK_TOKEN?: string
  LOG_LEVEL?: string
}

export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'
