# Cross-lane contracts

Every lane must follow these exactly. If a lane needs a change here or in `packages/core`, it does
NOT edit them; it reports the need.

## Ownership

| Concern                                               | Owner                                |
| ----------------------------------------------------- | ------------------------------------ |
| Enqueueing anything (ingest-items, render-jobs)       | `workers/ingest` (cron + reconciler) |
| found -> summarized -> embedded, insufficient_source  | `workers/ingest` consumer            |
| embedded -> voiced -> rendered, transcripts, R2 media | `workers/render`                     |
| Feed, auth, likes, events, Ask, /admin                | `apps/web`                           |

## Requeue rule (`item.queued_at`)

- `queued_at IS NULL` means "needs to be enqueued".
- Ingest cron/reconciler (every 5 min) enqueues: `found`/`summarized` with `queued_at IS NULL` -> `ingest-items`; `embedded` with `queued_at IS NULL` -> `render-jobs`; sets `queued_at = now()` when it sends.
- Same admission policy for every enqueue to `ingest-items` from `found` (score >= `SETTINGS.minItemScore`, today's admitted count < `SETTINGS.dailyReelCap`, pipeline spend today < `SETTINGS.pipelineDailySpendCapUsd`). Skipped items keep `queued_at = NULL` and are re-evaluated next run.
- Items in `found|summarized|embedded` with `queued_at < now() - 30 min` and no progress are treated as stuck: set `queued_at = NULL`, increment `attempts`; after 3 attempts `transitionItem(... to: 'failed')`.
- Admin Retry (web): `transitionItem(failed -> <stage>)` then `queued_at = NULL`.
- Render reconciler: renders stuck in `rendering` > 20 min -> render `failed`, item `queued_at = NULL`.

## Queues (Cloudflare)

- `ingest-items`: body `{ "itemId": "<uuid>", "attempt": <int> }`. max_retries 3, DLQ `ingest-items-dlq`.
- `render-jobs`: body `{ "itemId": "<uuid>", "attempt": <int> }`. max_retries 3, DLQ `render-jobs-dlq`.
- Consumers must be idempotent: `transitionItem` throws `StaleTransitionError` on duplicates -> ack and move on.

## Item script and text

- `item.tldr`: <= 280 chars plain text.
- `item.script`: JSON validated by `reelScriptSchema` (core). Written by ingest, read by render. Claims must cite `evidence_chunk.id`s that belong to the item.
- `item.content_hash`: `contentHash([title, tldr, JSON.stringify(script)])`. `item.prompt_version`: ingest's prompt version string.

## Evidence

- `evidence_chunk` rows per mention: thread body + top comments (Reddit/HN), README excerpt (GitHub), transcript (YouTube), article text (news). ~800 chars per chunk, 768-dim embedding via core helpers (raw `sql` with `toVectorLiteral`).

## Transcript service (render worker, service binding `RENDER` in ingest)

`POST https://render.internal/transcript` body `{ "videoId": "<11 chars>" }` ->

- `200 { "status": "ok", "language": "en", "segments": [{ "text": "...", "start": 0.0, "duration": 2.1 }] }`
- `200 { "status": "unavailable", "reason": "blocked" | "no_captions" | "error" }`
  `blocked` / `no_captions` = ingest transitions `found -> insufficient_source` (no fallback, by product decision). `error` (and any non-2xx) = transient: ingest retries the message.

## YouTube discovery service (render worker, same `RENDER` binding)

No YouTube Data API and no API key. Discovery runs in the render container with `youtube-search-python` (pin `httpx<0.28`; channel listing is broken in that library, so discovery is keyword search only).

`POST https://render.internal/youtube/search` body `{ "queries": string[], "maxAgeDays": int, "perQueryLimit": int }` ->

- `200 { "status": "ok", "videos": [{ "videoId", "title", "channelName", "channelId", "url", "publishedAt" (exact ISO from Video.getInfo), "viewCount" (int), "durationSec" (int|null), "description", "thumbnailUrl" }], "failedQueries": string[] }`
- Videos are de-duplicated by `videoId`, filtered to `publishedAt >= now - maxAgeDays`, and only fetched with `getInfo` when the search result's relative time ("3 days ago") is within the window.
- `502 { "status": "error", "reason": "..." }` when every query fails (library broken or blocked) -> ingest marks the youtube task failed and raises `youtube_search_failing`.
  Settings: `SETTINGS.youtubeSearchQueries`, `SETTINGS.youtubeMaxAgeDays`, `SETTINGS.youtubeResultsPerQuery`.

## Render output

- R2 bucket binding `MEDIA`. Keys: `reels/<itemId>/<renderKey>.mp4`, `reels/<itemId>/<renderKey>.jpg`.
- Video: 720x1280 30 fps H.264 (~1.8 Mbps), `+faststart`, AAC, captions burned in, <= 60 s, <= 25 MB.
- `render` row: unique `render_key` = core `renderKey({ itemId, contentHash, promptVersion, templateVersion, voice })`; `status done` with `video_key`, `poster_key`, `bytes`, `video_duration_ms`, `render_ms`.
- Retention: renders whose item `published_at` is older than `SETTINGS.reelRetentionDays` get their R2 objects deleted and `video_key = NULL`.
- Public URL = `MEDIA_PUBLIC_BASE_URL + "/" + video_key`.

### Render engine (container)

Python server (`/health`, `/transcript`, `/youtube/search`, `/render`) orchestrates; frames come from a Remotion 4.0.540 composition (`workers/render/container/remotion`, React 19) that is bundled at image build time and rendered with `@remotion/renderer` by `remotion/render.mjs`. FFmpeg only remuxes (`+faststart`) and cuts the poster.

`POST /render` body: `{ jobId, script, title, sourceLabel, voice, imageUrls[], source?, canonicalUrl?, sourceImageUrls[]?, illustrate? }` (extra fields are optional; old callers keep working). Response adds `illustration: bool` and `cover: bool` (default false for old containers).

- Timing: edge-tts word boundaries drive everything. Scene spans come from `timing.allocate_segments` (hook, one scene per beat, outro); captions page the same words with punctuation restored (`reel/words.py`); the poster is cut at the end of the hook.
- Scenes: kinetic hook, `title`, `code` (syntax highlight + typing), `stat` (count-up), `quote`, `image` (Ken Burns), outro with source and `reelset.app`. Content stays inside the app-UI safe zone (not in the bottom 22% or right 15%).
- Imagery (best effort, never fails a render): `sourceImageUrls` are direct URLs tried in order (GitHub social preview `opengraph.githubassets.com/1/<owner>/<repo>`, YouTube `i.ytimg.com` thumbnails; worker derives them in `plan.sourceImageUrls`). Otherwise the container reads `og:image` from `canonicalUrl` (https, every resolved address must be globally routable, redirects re-checked, <= 5 MB). Script `image` beats use the `imageUrls` allowlist (`github`, `ytimg`). Missing assets fall back to a generated cover.
- One AI illustration per reel: Gemini `gemini-2.5-flash-image` via REST in the container (`GEMINI_API_KEY` is passed to the container as env by the worker). Failure means no illustration. The worker records `recordSpend(category 'render', units 1, costUsd 0.039, meta.kind 'illustration')` when `illustration` is true.
- `TEMPLATE_VERSION` (worker `constants.ts`) is part of the render key. Bumping it re-renders: the render worker's 10-minute cron queues up to 6 `rendered` items per run that have no render row for the current key (skipped while any render is `rendering`), and the consumer renders `rendered` items without changing their status, so the old reel stays in the feed until the new `done` render (latest `finished_at` wins) replaces it.

## Feed visibility (web)

An item appears only if `item.status = 'rendered'` AND it has a `render` with `status = 'done'` AND `video_key IS NOT NULL` (latest such render wins).

## Settings, spend, alerts (core)

- Settings: `getSetting(db, SETTINGS.x, log)`; keys live in `app_setting`.
- Spend: `recordSpend(db, { category, units, costUsd }, log)` for every LLM, embedding, TTS and render call; `spendTodayUsd(db, [...])`. Pipeline uses `llm|embedding|tts|render`; Ask uses category `ask` only (meta.kind = llm|embedding), so the two caps never mix.
- Alerts: `sendAlert(db, env.ALERT_WEBHOOK_URL, { key, message, fields }, log)`, keys in `ALERT_KEYS`. Ingest owns: no_item_rendered_3h, source_lag, youtube_search_failing, spend_cap_reached, transcript_success_low. Render owns: render_failure_rate_high (> 20% failed in the last hour), dead_letter_growing.

## LLM + embeddings

- Provider: Google Gemini REST API via `fetch` (no SDK). Env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`. Embeddings requested with `outputDimensionality: 768`.
- Scraped text is untrusted data: wrap it in delimited blocks, tell the model to ignore instructions inside it, and post-validate outputs.

## Env vars

- ingest: `HYPERDRIVE` (binding), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GITHUB_TOKEN`, `ALERT_WEBHOOK_URL`, bindings `INGEST_ITEMS`, `RENDER_JOBS`, `RENDER` (service).
- render: `HYPERDRIVE`, `MEDIA` (R2), `REEL_CONTAINER` (container DO), `RENDER_JOBS` (producer for template upgrades), `TTS_VOICE` (default `en-US-AriaNeural`), `ALERT_WEBHOOK_URL`, `PROXY_URLS` and `GEMINI_API_KEY` (secrets, forwarded to the container).
- web: `DATABASE_URL` (Supabase pooler, transaction mode), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MEDIA_PUBLIC_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `ALERT_WEBHOOK_URL`, `ADMIN_EMAILS` (comma-separated, case-insensitive; matching verified users are promoted to admin, never demoted), `ADMIN_HOST`.
