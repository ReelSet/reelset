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

## LLM quota circuit breaker

A provider quota/billing error (HTTP 402, or 403/429 whose body says quota, billing or RESOURCE_EXHAUSTED) is a pipeline pause, not an item failure.

- `app_setting pipeline_paused` = `{ reason, since, until }` (`SETTINGS.pipelinePaused`; core `getPipelinePause`, `pausePipeline`, `clearPipelinePause`). `until` is the next probe time (15 min).
- The ingest consumer acks the message, sets `queued_at = NULL` and leaves `status` and `attempts` untouched; while paused it releases found/summarized items the same way without calling the provider.
- Reconcile, while paused: skips stuck handling and `found`/`summarized` enqueue (admission). Render enqueues continue. After `until` it makes one cheap embedding call; success clears the pause, a quota error extends it.
- Alert key `llm_quota_exhausted` (deduped hourly). The admin UI may show `pipeline_paused`.
- `scripts/maintenance/requeue-quota-failed.ts [--apply]` moves items failed with those errors back to the stage they failed in (`transitionItem`, `queued_at NULL`, `attempts 0`).

## Papers source

`Source` includes `papers`. Discovery in ingest: Hugging Face Daily Papers (`huggingface.co/api/daily_papers`, upvotes + comments are the score) and arXiv API listings (cs.AI/cs.CL/cs.CV/cs.LG, no score, below the admission floor until a Daily Papers mention scores them). Canonical key `arxiv:<id>` (version stripped, any arxiv abs/pdf/html URL, so HN links dedupe onto the paper), `canonical_url` `https://arxiv.org/abs/<id>`, kind `article`. Evidence: abstract + authors in the mention body; introduction and conclusion from `arxiv.org/html/<id>` in `raw.extraTexts` (fallback only, see Paper parsing service for the structured parse used at summarize time). Settings: `papers_hf_limit`, `papers_arxiv_categories`, `papers_arxiv_per_category`, `papers_max_age_days`. Render labels the source chip "Research".

## Firecrawl fallback (scrape)

Direct fetching is always tried first (papers evidence, HN and news article text). Firecrawl (`FIRECRAWL_API_KEY` ingest secret) is used only when the direct fetch errors, returns 401/403/429/451/503 or a challenge page, or yields text thinner than the threshold; 404/410 never trigger it. Each paid scrape is recorded as `recordSpend(category 'scrape', units 1, costUsd 0.005, meta { url, reason })`, capped by `scrape_daily_spend_cap_usd` (default 1), and the same URL is not scraped twice within 3 days. `scrape` is not part of the pipeline or Ask caps.

## Queues (Cloudflare)

- `ingest-items`: body `{ "itemId": "<uuid>", "attempt": <int> }`. max_retries 3, DLQ `ingest-items-dlq`.
- `render-jobs`: body `{ "itemId": "<uuid>", "attempt": <int> }`. max_retries 3 for most errors, 8 for `container_unreachable` (capped backoff), DLQ `render-jobs-dlq`.
- Consumers must be idempotent: `transitionItem` throws `StaleTransitionError` on duplicates -> ack and move on.

## Item script and text

- `item.tldr`: <= 280 chars plain text.
- `item.script`: JSON validated by `reelScriptSchema` (core). Written by ingest, read by render. Claims must cite `evidence_chunk.id`s that belong to the item.
- `item.content_hash`: `contentHash([title, tldr, JSON.stringify(script)])`. `item.prompt_version`: ingest's prompt version string.

### Beat sheet (script v7, prompt `reel-v3`)

- `script.headline` (optional, <= 7 words, shown uppercase for the first ~3 s) and per-beat `shots: [{ at, show, props?, sfx? }]` (<= 4 per beat). `at` is a spoken-word cue inside that beat's text: `word` or `word#n` (nth occurrence), case and punctuation ignored. `show` is a `ScreenName`, `sfx` an `SfxName`; the lists live in `packages/core/src/domain/reel-script.ts` and `workers/render/container/remotion/src/lib/types.ts` and a test keeps them equal. Both fields are optional: without shots the renderer's deterministic planner builds them.
- Ingest repair (`workers/ingest/src/pipeline/shots.ts`): headline clipped to 7 words; shots dropped when the cue word is not in the beat text, the screen or sfx is unknown, or a props number does not appear in the item's source text (`1,240`, `1240` and `1.24k` count as one value); narration over 135 words is rejected so the model retries (110-125 words, <= 58 s at Aura's ~140 wpm).
- Container (`reel/validation.py`, `reel/cues.py`): validates the same shape, resolves each cue to seconds against the TTS word times (`scene.shots[].t` in props, unresolved cues dropped with a warning) and passes `headline` through.
- Audio (`reel/mix.py`, `audio/`, generated by `tools/gen_audio.py`): the final mp4's audio is rebuilt after Remotion: Aura/edge narration normalised to -16 LUFS, a deterministic synthesized music bed (4 variants, ~-26 LUFS, picked by job id, looped) sidechain-ducked under speech, and SFX (`whoosh pop tick ding hit riser swoosh`, synthesized, no samples) at cue times: headline pop, a whoosh on every beat start, plus `<job>/timeline.json` shots written by `render.mjs` (`{ shots: [{ t, sfx }] }`; without it the script shots are used), a riser 1.3 s before a ding. Master `loudnorm` two-pass to -14 LUFS integrated, true peak <= -1.5 dBTP (limit -1). A mix failure falls back to the plain remux with the Remotion audio. `meta.mix` reports cues, bed and pre-master LUFS.
- QA: `scripts/qa/qa_reel.py video.mp4 props.json --out qa/` (wraps the vendored `qa_video.py`): average shot <= 2.5 s, none > 4 s (planned and detected), caption pages, frozen stretches, flat frames, -14 LUFS +/-1, TP <= -1.

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

## Paper parsing service (render worker, same `RENDER` binding)

Papers are parsed in the render container (Python: BeautifulSoup+lxml, PyMuPDF, pymupdf4llm, Pillow, optional Ghostscript), not in the ingest worker. Ingest calls it at summarize time for `arxiv:` items, so the cron fetch stays cheap.

`POST https://render.internal/parse/paper` body `{ "arxivId": "2611.08264" }` (version suffix allowed, old-style ids allowed) ->

- `200 { "status": "ok", "paper": ParsedPaper, "stats"?, "cached"? }`; `200 { "status": "failed", "reason": "not_parseable" }`; `502` for container or validation errors; `400` for a bad id. Ingest treats everything except `ok` as "no parsed paper" and falls back to today's behaviour (abstract + regex intro/conclusion from `raw.extraTexts`, then the Firecrawl PDF scrape if that text is empty).
- Storage: R2 `papers/<id>/paper.json` (`/` in old-style ids becomes `_`) plus figure files `papers/<id>/fig-<n>.png|jpg` served from `MEDIA_PUBLIC_BASE_URL` (default `https://media.reelset.app`). The JSON is the cache: a hit with the current `PAPER_PARSER_VERSION` skips the container. No database column; item.images keeps the figure URLs, the table and equation data a reel needs is copied into the shot props when the script is generated.
- `ParsedPaper` (zod in `packages/core/src/domain/parsed-paper.ts`, Python producer in `workers/render/container/reel/paper/`): `title, authors, affiliations, abstract`, `sections[{heading, level 2-4, kind: abstract|intro|related|method|experiments|conclusion|appendix|other, markdown}]` (flat, direct content only; math as `$latex$` from the MathML alttext, citations and footnotes removed), `tables[{id, label ("Table 2"), caption, headers[], rows[][], best[[row,col]], second, bestBy: bold|computed|none, notes}]` (multirow/multicol expanded onto the grid; group headers are joined onto leaf columns; `bold` = bold in the source, `computed` = per-column best from explicit up/down arrows when nothing is bold), `figures[{label, caption, url, width, height, hires, origin: eprint|latexml|pdf}]`, `equations[{latex, label}]` (up to 6 numbered display equations), `links[{kind: code|project, url}]`, `markdown` (compact rendering), `source: html|pdf`, `version`.
- Parse order: (1) `arxiv.org/html/<id>` LaTeXML with a real DOM parser; (2) hi-res figures from `arxiv.org/e-print/<id>` (tar.gz, 60 MB cap): `\input`/`\include` are expanded, `\begin{figure}` blocks give `\includegraphics` + `\caption` + `\label`, captions are matched to the HTML figures by similarity (order if counts agree), PDF figures are rendered with PyMuPDF at about 1600 px wide and cropped, rasters are kept (no upscaling), EPS needs Ghostscript (skipped if absent); LaTeXML copies stay for anything not converted; (3) no HTML: `arxiv.org/pdf/<id>` via pymupdf4llm (markdown, pipe tables, sections) plus embedded images of at least 420x240, and e-print figures when available. If all of that fails the container answers `failed`.
- Etiquette: arXiv hosts only, one request at a time with a 3 s gap, user agent `reelset-paper-parser/1.0`, size caps, a time budget of 85 s in the container (the worker waits 110 s). e-print is skipped when under 25 s remain.
- Evidence for the LLM (`paperEvidenceTexts`): introduction, method, experiments/results, the main results table as markdown (best cells in bold, label and caption included) and the conclusion, about 11k characters at most. A `PAPER_ASSETS` prompt block lists real table, figure (with image index) and equation labels.
- Shots: `TableScreen {table, row?, metric?}` and `EquationScreen {equation, label?}`, plus `FigureZoom {figure?}`. After generation `resolvePaperShots` replaces the references with renderer props (`TableScreen`: `ref, caption, headers[<=4], rows["a|b|c"...<=6], hi, col, value, label, best["r:c"...]`; `EquationScreen`: `latex, label`; `FigureZoom`: `image` index) and drops shots whose reference does not exist; both paper screens are dropped for items without a parsed paper. Table props use flat strings and numbers only because the container validator rejects nested lists deeper than two levels and booleans.
- Remotion: `TableScreen` (rows pop in, the best row gets a sweep, the key number counts up, 3 value columns and 6 rows at most) and `EquationScreen` (KaTeX, static, scaled to fit). They hold 2.6 s and 2.2 s before the next cue and are kept up to 5.4 s and 4.8 s (`lib/table.ts`). `FigureZoom` never shows an image above 1.2x its pixels and keeps the whole figure in frame.

## Render output

- R2 bucket binding `MEDIA`. Keys: `reels/<itemId>/<renderKey>.mp4`, `reels/<itemId>/<renderKey>.jpg`.
- Video: 1080x1920 30 fps H.264 (~3 Mbps), `+faststart`, AAC, captions burned in at 58-72% of frame height (centered, 72% wide, 2 lines max; `theme.ts` is the single source) so they clear the app bottom overlay and right rail, <= 60 s, <= 25 MB.
- `render` row: unique `render_key` = core `renderKey({ itemId, contentHash, promptVersion, templateVersion, voice })`; `status done` with `video_key`, `poster_key`, `bytes`, `video_duration_ms`, `render_ms`.
- Retention: renders whose item `published_at` is older than `SETTINGS.reelRetentionDays` get their R2 objects deleted and `video_key = NULL`.
- Public URL = `MEDIA_PUBLIC_BASE_URL + "/" + video_key`.

### Render engine (container)

Python server (`/health`, `/transcript`, `/youtube/search`, `/render`) orchestrates; frames come from a Remotion 4.0.540 composition (`workers/render/container/remotion`, React 19) that is bundled at image build time and rendered with `@remotion/renderer` by `remotion/render.mjs`. FFmpeg only remuxes (`+faststart`) and cuts the poster.

`POST /render` body: `{ jobId, script, title, sourceLabel, voice, imageUrls[], source?, canonicalUrl?, sourceImageUrls[]? }` (extra fields such as the legacy `illustrate` are ignored). Response adds `cover: bool` (default false).

- Timing: edge-tts word boundaries drive everything. Scene spans come from `timing.allocate_segments` (hook, one scene per beat, outro); captions page the same words with punctuation restored (`reel/words.py`); the poster is cut at the end of the hook.
- Scenes: kinetic hook, `title`, `code` (syntax highlight + typing), `stat` (count-up), `quote`, `image` (Ken Burns), outro with source and `reelset.app`. Content stays inside the app-UI safe zone (not in the bottom 22% or right 15%).
- Imagery (best effort, never fails a render): `sourceImageUrls` are direct URLs tried in order (GitHub social preview `opengraph.githubassets.com/1/<owner>/<repo>`, YouTube `i.ytimg.com` thumbnails; worker derives them in `plan.sourceImageUrls`). Otherwise the container reads `og:image` from `canonicalUrl` (https, every resolved address must be globally routable, redirects re-checked, <= 5 MB). Script `image` beats use the `imageUrls` allowlist (`github`, `ytimg`). Missing assets fall back to a generated cover.
- TTS provider: app_setting `tts_provider` (`edge` default | `aura2`) and `tts_aura_speaker` (default `hera`). `aura2` runs in the render worker through the `AI` binding: `@cf/deepgram/aura-2-en` (mp3, $0.03 per 1k chars, text chunked on sentence boundaries at 1500 chars) then `@cf/deepgram/nova-3` on the audio ($0.0052/min) for word times, which `alignWords` maps onto the script's own tokens (LCS anchors on normalized words; numbers, hyphenated terms and ASR slips share their gap's time window; under 50% anchors falls back to per-character timing). The worker POSTs `narration: { audioBase64, words: [{ text, start, end }] }` in the `/render` body (container limit 8 MB) and the container skips edge-tts and punctuation restoration. The render-key voice is `aura2-<speaker>` (edge keeps `TTS_VOICE`), so switching provider or speaker re-renders via the template upgrade cron. Workers AI failure is `tts_unavailable` (retryable); from the 3rd delivery on, or if narration exceeds 58 s, the job falls back to edge-tts with the edge voice and a warning. Spend: `tts` row with cost chars x $0.00003 + audio seconds x nova rate, `meta.provider`. Helper: `scripts/smoke/aura/aura.mjs`.
- Source images (v6): ingest stores `item.images` (jsonb, max 6: `[{url, kind: og|thumbnail|figure|screenshot|avatar, width?, height?, alt?}]`, null = not captured) at summarize time (`workers/ingest/src/images.ts`; backfill `scripts/maintenance/backfill-item-images.ts`). Render loads it via `ItemForRender.images` and sends `images` in `POST /render`; the container (`reel/source_images.py`) downloads https public URLs (<= 8 MB, image/*, gif <= 5 MB), drops < 240x140 / extreme aspect / blank / near-duplicates, re-encodes JPEG (<= 1280px, never upscaled) as `assets/img<N>.jpg`, and passes `props.images = [{src: 'job/img<N>.jpg', kind, width, height, alt?}]` (+ `cover` = first). Remotion shows the hero in the hook (play badge for YouTube), figures/screenshots in image beats with a source caption, and falls back to drawn motifs when none. Items without `images` fall back to `sourceImageUrls`/og:image as before.
- No AI/LLM image generation in rendering. All visuals are code-drawn Remotion/SVG motion graphics (`remotion/src/art/*`): the motif (network, terminal, git graph, bars, paper, video timeline, discussion thread) is chosen deterministically by `lib/art.ts` from source, title/script keywords and beat visual types. Real source imagery (YouTube thumbnail, GitHub social preview, og:image) is fetched best-effort and shown only as a small source card in the outro; a reel renders identically with zero external images. Render spend is `tts` + `render` rows only.
- `TEMPLATE_VERSION` (worker `constants.ts`) is part of the render key. Bumping it re-renders: the render worker's 5-minute cron tops re-renders up to 2x container `max_instances` (6) in flight: it queues `rendered` items with no render row for the current key, minus `rendering` renders, upgrades it sent in the last 15 min that have not started (tracked in `app_setting.render_upgrade_sent`), and the backlog of new `embedded`/`voiced` items, so new items keep priority, and the consumer renders `rendered` items without changing their status, so the old reel stays in the feed until the new `done` render (latest `finished_at` wins) replaces it.

### Template 7: beat-sheet composition (1080x1920, 30 fps)

Replaces the card-on-empty-background look with full-bleed screens cut on spoken words.

- Script contract: `script.headline` (<= 7 words, rendered uppercase in a 0-3 s accent card) and per-beat optional `shots: [{ at, show, props?, sfx?, t? }]`. `at` is a spoken-word cue (`word` or `word#2`); the container resolves it to `t` seconds (`reel/cues.py`), the composition falls back to its own matching (`lib/cues.ts`, exact then prefix) and, if a cue is missing, logs `[plan] ...` and uses planner timing. Never fatal. `show` is `ScreenName`, `sfx` is `SfxName`; both enum lists live in `remotion/src/lib/types.ts` and `reel/validation.py` (keep in sync).
- `ScreenName`: RepoPage, Terminal, CodeBlock, StatSlam, BarRace, HNThread, RedditPost, YouTubePlayer, PaperPage, FigureZoom, ArticleHeadline, ImageFull, KeyPoint, Compare, EndCard. Common props: `image` (index into `props.images`), `value`/`label`, `text`/`sub`, `lines`, `code`/`language`, `bars`, `left`/`right`, `phrase`, `quote`/`by`.
- Without shots, `lib/planner.ts` plans deterministically: chunks of 1.5-2.5 s on word boundaries (preferring punctuation), a screen per chunk from the beat visual, numbers in the narration, item facts and images; no screen repeats back to back, a real image at least every ~5.5 s when `images` exist, nothing held over 4 s, EndCard last.
- Optional `facts` in the `/render` body (real item metadata, whitelisted in `validation._validate_facts`): `repo {owner,name,description,stars,forks,language,languages[{name,pct}],topics}`, `hn {points,comments,author,topComment}`, `reddit {subreddit,upvotes,comments,author}`, `youtube {channel,views,duration}`, `paper {authors,abstract,upvotes}`, `article {site,author}`. Screens only show counts that exist here or in the script; callers (render worker) should pass them when known.
- FX: Punch (1.1 -> 1 plus white flash, 6 frames) on every cut, Drift on holds, Pop on cards and rows, vignette and grain.
- Captions: 1-4 word pages, heavy white outline text with the spoken word in an accent box, inside the 58-72% band (776 px wide). Top chrome (progress, source chip, wordmark) starts at 12% (230 px).
- The composition writes `<job>/timeline.json` (`{ fps, shots: [{ t, seconds, show, sfx, origin, scene }] }`) for the audio mix. `riser` lead-ins are added by the mix before `ding` cues.
- Video bitrate is 3000k at 1080x1920 (60 s stays under 25 MB).
- Facts (render worker `facts.ts`): built from stored mentions only (score/num_comments/author + `mention.raw.facts` captured at ingest: github forks/language/topics/latestRelease, HN topComment, reddit subreddit, youtube durationSec). Missing fields are omitted. Backfill: `scripts/maintenance/backfill-mention-facts.ts`; regenerate scripts for feed items with the current prompt: `scripts/maintenance/regen-scripts.ts` (status untouched; render cron upgrades on the new content hash).
- Transitions (`lib/transitions.ts`): deterministic punch / slide / whip / cut / rise per cut, first shot none; flash only on punch. A thumbnail is shown big once.
- Render budget: Remotion concurrency defaults to min(2, cpus) (measured fastest; jpeg quality and x264 preset made no difference); `REMOTION_TIMEOUT_SECONDS` 780, worker `RENDER_TIMEOUT_MS` 14 min (queue consumer wall limit is 15), stuck reaper 30 min.
- Aura over 58 s: re-synthesized once from a script with trailing sentences cut (`shortenScript`), then edge-tts.

## Feed visibility (web)

An item appears only if `item.status = 'rendered'` AND it has a `render` with `status = 'done'` AND `video_key IS NOT NULL` (latest such render wins).

## Settings, spend, alerts (core)

- Settings: `getSetting(db, SETTINGS.x, log)`; keys live in `app_setting`.
- Spend: `recordSpend(db, { category, units, costUsd }, log)` for every LLM, embedding, TTS and render call; `spendTodayUsd(db, [...])`. Pipeline uses `llm|embedding|tts|render`; Ask uses category `ask` only (meta.kind = llm|embedding), so the two caps never mix.
- Alerts: `sendAlert(db, env.ALERT_WEBHOOK_URL, { key, message, fields }, log)`, keys in `ALERT_KEYS`. Ingest owns: no_item_rendered_3h, source_lag, youtube_search_failing, spend_cap_reached, transcript_success_low, llm_quota_exhausted. Render owns: render_failure_rate_high (> 20% failed in the last hour), dead_letter_growing.

## LLM + embeddings

- Provider: Google Gemini REST API via `fetch` (no SDK). Env: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`. Embeddings requested with `outputDimensionality: 768`.
- Scraped text is untrusted data: wrap it in delimited blocks, tell the model to ignore instructions inside it, and post-validate outputs.

## Env vars

- ingest: `HYPERDRIVE` (binding), `FIRECRAWL_API_KEY` (secret, optional), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GITHUB_TOKEN`, `ALERT_WEBHOOK_URL`, bindings `INGEST_ITEMS`, `RENDER_JOBS`, `RENDER` (service).
- render: `HYPERDRIVE`, `MEDIA` (R2), `REEL_CONTAINER` (container DO), `RENDER_JOBS` (producer for template upgrades), `TTS_VOICE` (default `en-US-AriaNeural`), `ALERT_WEBHOOK_URL`, `PROXY_URLS` (secret, forwarded to the container).
- web: `DATABASE_URL` (Supabase pooler, transaction mode), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `MEDIA_PUBLIC_BASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `ALERT_WEBHOOK_URL`, `ADMIN_EMAILS` (comma-separated, case-insensitive; matching verified users are promoted to admin, never demoted), `ADMIN_HOST`.
