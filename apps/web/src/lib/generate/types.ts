import type { PublishState, RequestStep } from '@reelset/core'

export type GenerateStep = RequestStep
export type GenerateStepKey = RequestStep['key']

export type ReelRequestStatus = 'pending' | 'resolving' | 'processing' | 'done' | 'failed'

export type PublishInfo = {
  state: PublishState
  /** Only the reel's owner can submit or withdraw it. */
  owned: boolean
  requestedAt: string | null
  reviewedAt: string | null
  note: string | null
}

export type GeneratedReel = {
  itemId: string
  title: string | null
  pageUrl: string | null
  videoUrl: string | null
  /** Same video served with Content-Disposition: attachment, so the browser saves it. */
  downloadUrl: string | null
  posterUrl: string | null
  durationMs: number | null
  visibility: 'public' | 'private'
  publish: PublishInfo
}

export type ReelRequestDto = {
  id: string
  urls: string[]
  status: ReelRequestStatus
  error: string | null
  createdAt: string
  via: 'web' | 'mcp' | 'admin'
  creditsCharged: number
  steps: GenerateStep[]
  /** Priority requests ahead of this one that are not rendered yet; null once it is rendering. */
  aheadOfYou: number | null
  reel: GeneratedReel | null
}

export type CreditsDto = {
  balance: number
  monthlyFree: number
  cost: number
  resetsAt: string
  unlimited: boolean
  reelsLeft: number
}

export type GenerateResponse = { request: ReelRequestDto; credits: CreditsDto }
export type GenerateListResponse = { requests: ReelRequestDto[]; credits: CreditsDto }
export type ApiError = {
  error:
    | 'unauthorized'
    | 'invalid_urls'
    | 'out_of_credits'
    | 'too_many_open'
    | 'daily_limit'
    | 'not_found'
    | 'already_requested'
    | 'not_publishable'
    | 'internal'
  message: string
}

export type ApiKeyDto = {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export const MAX_URLS_PER_REQUEST = 5

const DOWNLOAD_BASE = 'https://render-api.reelset.app/dl'

export function reelDownloadUrl(videoKey: string | null, title: string | null): string | null {
  if (!videoKey) return null
  const name = title ? `?name=${encodeURIComponent(title.slice(0, 80))}` : ''
  return `${DOWNLOAD_BASE}/${videoKey.replace(/^\//, '')}${name}`
}
