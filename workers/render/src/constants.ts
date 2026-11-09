export const TEMPLATE_VERSION = '2'
export const DEFAULT_VOICE = 'en-US-AriaNeural'

export const MAX_RETRIES = 3
export const RETRY_BASE_DELAY_SECONDS = 30

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024
export const CONTAINER_SLOTS = 3
export const CONTAINER_BASE_URL = 'http://container'
export const RENDER_TIMEOUT_MS = 8 * 60_000
export const TRANSCRIPT_TIMEOUT_MS = 45_000
export const YOUTUBE_SEARCH_TIMEOUT_MS = 120_000

export const STUCK_RENDER_MINUTES = 20
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60_000
export const ORPHAN_SCAN_PAGE_SIZE = 1000
export const RETENTION_BATCH_SIZE = 100
export const ORPHAN_CURSOR_SETTING_KEY = 'render_orphan_scan_cursor'

export const FAILURE_RATE_THRESHOLD = 0.2
export const FAILURE_RATE_MIN_RENDERS = 5
export const FAILURE_RATE_WINDOW_MS = 60 * 60_000
export const DEAD_LETTER_ALERT_MIN = 3
export const DEAD_LETTER_WINDOW_MS = 60 * 60_000

// Cloudflare Containers list pricing (standard-4: 4 vCPU, 12 GiB, 20 GB disk), USD per second.
export const CONTAINER_USD_PER_SECOND = 4 * 0.00002 + 12 * 0.0000025 + 20 * 0.00000007
export const EDGE_TTS_USD_PER_CHAR = 0
export const ILLUSTRATION_USD = 0.039

export const UPGRADE_BATCH_SIZE = 6
export const UPGRADE_CANDIDATE_LIMIT = 500
