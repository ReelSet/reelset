import type { JobMessage } from './consumer'
import type { IgRunMessage } from './instagram/routes'

export type Env = {
  HYPERDRIVE: Hyperdrive
  MEDIA: R2Bucket
  RENDER_BOX_URL: string
  HELPER_BOX_URL?: string
  RENDER_BOX_TOKEN?: string
  NORTHFLANK_API_TOKEN?: string
  NORTHFLANK_PROJECT_ID?: string
  NORTHFLANK_SERVICE_ID?: string
  TTS_VOICE?: string
  AI?: Ai
  ALERT_WEBHOOK_URL?: string
  PEXELS_API_KEY?: string
  IG_ADMIN_TOKEN?: string
  IG_SESSION_KEY?: string
  IG_USERNAME?: string
  IG_PASSWORD?: string
  IG_TOTP_SECRET?: string
  MEDIA_PUBLIC_BASE_URL?: string
  RENDER_JOBS: Queue<JobMessage>
  IG_RUN: Queue<IgRunMessage>
  LOG_LEVEL?: string
}
