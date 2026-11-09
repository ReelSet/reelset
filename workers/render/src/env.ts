import type { ReelContainer } from './container'

export type Env = {
  HYPERDRIVE: Hyperdrive
  MEDIA: R2Bucket
  REEL_CONTAINER: DurableObjectNamespace<ReelContainer>
  TTS_VOICE?: string
  ALERT_WEBHOOK_URL?: string
  PROXY_URLS?: string
  GEMINI_API_KEY?: string
  RENDER_JOBS: Queue<{ itemId: string }>
  LOG_LEVEL?: string
}
