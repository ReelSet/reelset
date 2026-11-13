const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const ARCTIC_BASE_URL = 'https://arctic-shift.photon-reddit.com'
export const ARCTIC_HOST_INTERVAL_MS = 1500
export const ARCTIC_ATTEMPTS = 4
export const ARCTIC_TIMEOUT_MS = 60_000
export const ARCTIC_RETRYABLE_STATUSES = [422] as const
// Arctic Shift answers HTTP 400 for any field it does not know (e.g. 'stickied'), so keep this list to verified fields.
export const POST_FIELDS =
  'id,created_utc,title,selftext,author,score,num_comments,subreddit,url,over_18'
export const COMMENT_FIELDS = 'id,created_utc,body,author,link_id,parent_id,score'
export const REDDIT_SCORE_SETTLE_HOURS = 10
export const REDDIT_REFRESH_BATCH = 100
export const REDDIT_REFRESH_PAGES = 4
export const REDDIT_MIN_COMMENTS_FOR_TREE = 3

export const HN_ALGOLIA_BASE = 'https://hn.algolia.com/api/v1'
export const HN_MIN_POINTS = 20
export const HN_HITS_PER_PAGE = 100
export const HN_MAX_COMMENT_FETCHES = 15

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_MIN_STARS = 50
export const GITHUB_PER_PAGE = 50
export const GITHUB_MAX_README_FETCHES = 20
export const GITHUB_README_EXCERPT_CHARS = 6000

export const YOUTUBE_SEARCH_URL = 'https://render.internal/youtube/search'
export const YOUTUBE_SEARCH_SCOPE = 'search'
export const YOUTUBE_DESCRIPTION_CHARS = 2000
export const YOUTUBE_FAILING_RUNS = 3

export const NEWS_MAX_ENTRIES_PER_FEED = 40
export const NEWS_BODY_CHARS = 8000

export const HF_PAPERS_URL = 'https://huggingface.co/api/daily_papers'
export const ARXIV_API_URL = 'https://export.arxiv.org/api/query'
export const ARXIV_HOST_INTERVAL_MS = 3000
export const PAPERS_SCOPE_HF = 'hf-daily'
export const PAPERS_SCOPE_ARXIV = 'arxiv'
export const PAPERS_MAX_EVIDENCE_FETCHES = 20
export const PAPER_PARSE_TIMEOUT_MS = 115_000
export const PAPERS_INTRO_CHARS = 3500
export const PAPERS_CONCLUSION_CHARS = 2000
export const PAPERS_MIN_SECTION_CHARS = 600

export const ARTICLE_TEXT_CHARS = 6000
export const ARTICLE_MIN_CHARS = 400
export const ARTICLE_TIMEOUT_MS = 15_000
export const HN_MAX_ARTICLE_FETCHES = 10
export const NEWS_MAX_ARTICLE_FETCHES = 10
export const NEWS_THIN_ENTRY_CHARS = 600

export const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'
export const FIRECRAWL_COST_USD = 0.005
export const FIRECRAWL_TIMEOUT_MS = 45_000
export const FIRECRAWL_REPEAT_DAYS = 3

export const PERSIST_CHUNK = 100
export const RUN_STUCK_AFTER_MS = 30 * 60_000
export const INGEST_RUN_DEADLINE_MS = 10 * 60_000
export const INCREMENTAL_OVERLAP_MS = 2 * HOUR_MS
export const INCREMENTAL_COLD_START_MS = DAY_MS
export const BACKFILL_WINDOW_MS = 14 * DAY_MS
export const MODE_MAX_PAGES = { incremental: 3, backfill: 10 } as const
export const MODE_HOST_INTERVAL_MS = { incremental: 300, backfill: 500 } as const

export const STUCK_AFTER_MS = 30 * 60_000
// Busy-box deferrals last up to ~4h (320 x 45s) and a render is failed after 60 min.
export const RENDER_QUEUED_LIVE_MS = 5 * 60 * 60_000
export const RENDER_RENDERING_LIVE_MS = 75 * 60_000
export const MAX_STUCK_ATTEMPTS = 3
export const RECONCILE_BATCH = 200
export const ADMISSION_CANDIDATES = 600
export const ENQUEUE_CHUNK = 50

export const CHUNK_TARGET_CHARS = 800
export const MAX_CHUNKS_PER_MENTION = 12
export const MAX_TRANSCRIPT_CHUNKS = 16
export const MIN_EVIDENCE_CHARS = 150

export const MAX_TLDR_CHARS = 280
export const EMBED_BATCH_SIZE = 50
export const QUEUE_MAX_RETRIES = 3

export const ALERT_NO_RENDER_MS = 3 * HOUR_MS
export const ALERT_SOURCE_LAG_MS = 2 * HOUR_MS
export const TRANSCRIPT_WINDOW = 20
export const TRANSCRIPT_MIN_ATTEMPTS = 10
export const TRANSCRIPT_MIN_SUCCESS = 0.5
export const SPEND_CATEGORIES_FOR_CAP = ['llm', 'embedding', 'tts', 'render'] as const

export const USER_AGENT = 'reelset-ingest/0.1 (+https://reelset.dev)'
