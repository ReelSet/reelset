import type { ReelContainer } from './container'
import type { IgRunMessage } from './instagram/routes'

export type Env = {
  HYPERDRIVE: Hyperdrive
  MEDIA: R2Bucket
  REEL_CONTAINER: DurableObjectNamespace<ReelContainer>
  TTS_VOICE?: string
  AI?: Ai
  ALERT_WEBHOOK_URL?: string
  PROXY_URLS?: string
  PEXELS_API_KEY?: string
  IG_ADMIN_TOKEN?: string
  IG_SESSION_KEY?: string
  IG_USERNAME?: string
  IG_PASSWORD?: string
  IG_TOTP_SECRET?: string
  MEDIA_PUBLIC_BASE_URL?: string
  RENDER_JOBS: Queue<{ itemId: string }>
  IG_RUN: Queue<IgRunMessage>
  LOG_LEVEL?: string
}
