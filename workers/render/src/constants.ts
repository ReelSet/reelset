export const TEMPLATE_VERSION = '8'
export const DEFAULT_VOICE = 'en-US-AriaNeural'

export const MAX_RETRIES = 3
export const RETRY_BASE_DELAY_SECONDS = 30
export const UNREACHABLE_MAX_RETRIES = 8
export const UNREACHABLE_MAX_DELAY_SECONDS = 300

export const CONTAINER_TITLE_MAX_CHARS = 200
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024
export const CONTAINER_BASE_URL = 'http://container'
export const BOX_BUSY_STATUS = 429
export const CLOUDFLARE_ORIGIN_TIMEOUT_STATUS = 524
export const BUSY_RETRY_DELAY_SECONDS = 45
// A free 1/8-OCPU box can take an hour or more per reel; keep re-checking for about 4 hours.
export const BUSY_MAX_DEFERRALS = 320
export const RENDER_TIMEOUT_MS = 14 * 60_000
export const TRANSCRIPT_TIMEOUT_MS = 45_000
export const YOUTUBE_SEARCH_TIMEOUT_MS = 120_000
export const PAPER_PARSE_TIMEOUT_MS = 110_000
// A Micro under render load answers /health in 2-3 s locally and slower through the tunnel.
export const BOX_HEALTH_TIMEOUT_MS = 20_000
export const BOX_SAMPLE_RETENTION_DAYS = 30
export const DEFAULT_MEDIA_BASE_URL = 'https://media.reelset.app'

export const STUCK_RENDER_MINUTES = 30
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60_000
export const ORPHAN_SCAN_PAGE_SIZE = 1000
export const RETENTION_BATCH_SIZE = 100
export const ORPHAN_CURSOR_SETTING_KEY = 'render_orphan_scan_cursor'

export const FAILURE_RATE_THRESHOLD = 0.2
export const FAILURE_RATE_MIN_RENDERS = 5
export const FAILURE_RATE_WINDOW_MS = 60 * 60_000
export const DEAD_LETTER_ALERT_MIN = 3
export const DEAD_LETTER_WINDOW_MS = 60 * 60_000

// Northflank nf-compute-200 (2 vCPU, 4 GB): $0.01667/vCPU-h + $0.00833/GB-h, billed per second while the box runs.
export const CONTAINER_USD_PER_SECOND = (2 * 0.01667 + 4 * 0.00833) / 3600
export const EDGE_TTS_USD_PER_CHAR = 0

export const UPGRADE_IN_FLIGHT_TARGET = 6
export const UPGRADE_BATCH_SIZE = UPGRADE_IN_FLIGHT_TARGET
export const UPGRADE_PENDING_TTL_MS = 15 * 60_000
export const UPGRADE_SENT_SETTING_KEY = 'render_upgrade_sent'
export const UPGRADE_CANDIDATE_LIMIT = 500
export const UPGRADE_MAX_ATTEMPTS = 8
export const UPGRADE_FRESHNESS_HALF_LIFE_DAYS = 2
