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
export const BUSY_MAX_DEFERRALS = 160
export const RENDER_TIMEOUT_MS = 14 * 60_000
export const TRANSCRIPT_TIMEOUT_MS = 45_000
export const YOUTUBE_SEARCH_TIMEOUT_MS = 120_000
export const PAPER_PARSE_TIMEOUT_MS = 110_000
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

// Cloudflare Containers list pricing (standard-3), kept as the notional render cost although the box is a flat-rate VM.
export const CONTAINER_USD_PER_SECOND = 2 * 0.00002 + 8 * 0.0000025 + 16 * 0.00000007
export const EDGE_TTS_USD_PER_CHAR = 0

export const UPGRADE_IN_FLIGHT_TARGET = 6
export const UPGRADE_BATCH_SIZE = UPGRADE_IN_FLIGHT_TARGET
export const UPGRADE_PENDING_TTL_MS = 15 * 60_000
export const UPGRADE_SENT_SETTING_KEY = 'render_upgrade_sent'
export const UPGRADE_CANDIDATE_LIMIT = 500
export const UPGRADE_MAX_ATTEMPTS = 8
export const UPGRADE_FRESHNESS_HALF_LIFE_DAYS = 2
