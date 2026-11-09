import type { ReelContainer } from './container'

export type Env = {
  HYPERDRIVE: Hyperdrive
  MEDIA: R2Bucket
  REEL_CONTAINER: DurableObjectNamespace<ReelContainer>
  TTS_VOICE?: string
  AI?: Ai
  ALERT_WEBHOOK_URL?: string
  PROXY_URLS?: string
  PEXELS_API_KEY?: string
  MEDIA_PUBLIC_BASE_URL?: string
  RENDER_JOBS: Queue<{ itemId: string }>
  LOG_LEVEL?: string
}
