import type { JobMessage } from './consumer'
import type { IgRunMessage } from './instagram/routes'

export type Env = {
  HYPERDRIVE: Hyperdrive
  MEDIA: R2Bucket
  BOX_URLS: string
  RENDER_BOX_TOKEN?: string
  TTS_VOICE?: string
  AI?: Ai
  CHATTERBOX_URL?: string
  CHATTERBOX_TOKEN?: string
  /** Qwen3-TTS narrator on Modal; authenticates with CHATTERBOX_TOKEN. A secret, like CHATTERBOX_URL. */
  QWEN_TTS_URL?: string
  ALERT_WEBHOOK_URL?: string
  PEXELS_API_KEY?: string
  IG_ADMIN_TOKEN?: string
  IG_SESSION_KEY?: string
  IG_USERNAME?: string
  IG_PASSWORD?: string
  IG_TOTP_SECRET?: string
  /** Optional: lets the official publisher read its token's expiry and refresh it. */
  META_APP_ID?: string
  META_APP_SECRET?: string
  MEDIA_PUBLIC_BASE_URL?: string
  RENDER_JOBS: Queue<JobMessage>
  IG_RUN: Queue<IgRunMessage>
  LOG_LEVEL?: string
}
