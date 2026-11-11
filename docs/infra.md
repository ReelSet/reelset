# Infrastructure

Secrets and ids live in `reelset/.env.local` (git-ignored). Nothing here is secret.

## Domains

| Host                | Serves                                                |
| ------------------- | ----------------------------------------------------- |
| `reelset.app`       | Web app (Vercel)                                      |
| `admin.reelset.app` | Same Vercel app, host-routed to `/admin`              |
| `media.reelset.app` | R2 bucket `reelset-media` (custom domain, SSL active) |

DNS is on Cloudflare (zone `reelset.app`). Vercel records must be DNS-only (grey cloud).

## Cloudflare (account `deea05d3…`, Workers Paid)

- Queues: `ingest-items`, `ingest-items-dlq`, `render-jobs`, `render-jobs-dlq`
- R2: `reelset-media`, custom domain `media.reelset.app`
- Hyperdrive: `reelset-db` (id in `.env.local` as `HYPERDRIVE_ID`) -> Supabase direct connection
- Workers: `reelset-ingest`, `reelset-render` (deployed)

## Supabase (project `ydcasrnilwtvtcfveamz`)

- Postgres 17, pgvector 0.8.2, RLS on every public table, migrations via `npm run db:deploy`
- Auth: Site URL `https://reelset.app`; redirects `https://reelset.app/**`, `https://admin.reelset.app/**`, `http://localhost:3000/**`
- Keys: publishable key in `.env.local` as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Auth email goes through Resend SMTP (`smtp.resend.com:465`, user `resend`, password = `RESEND_API_KEY`), sent as `Reelset <login@reelset.app>` from the verified `reelset.app` domain. Rate limit is 100 emails/hour (`auth.rate_limit.email_sent`).
- Auth config lives in `supabase/config.toml`; branded email templates (magic link, confirm signup, email change) live in `supabase/templates/`. Apply with `RESEND_API_KEY=... npx supabase config push --remote ydcasrnilwtvtcfveamz`. Run it without `--yes` first to read the diff; keep `config.toml` aligned with the remote so the push changes only what you mean to. The SMTP password is read from `env(RESEND_API_KEY)` and is never committed.
- Templates use `{{ .ConfirmationURL }}` (PKCE); the app's `/auth/callback` accepts both `code` and `token_hash`.
- The direct DB host is IPv6-only; Vercel needs the transaction pooler URL (see `.env.example`).

## Vercel (apps/web)

- No `vercel.json`. Project setting Root Directory = `apps/web`, "Include files outside the Root Directory" on (default), Framework Preset Next.js.
- Vercel detects the npm workspaces lockfile at the repo root and runs `npm install` there, so `@reelset/core` resolves; `next.config.ts` has `transpilePackages: ['@reelset/core']`.
- Build/output commands stay default (`next build`). `npm run build -w @reelset/web` passes locally.
- Env vars: see the web list in `docs/contracts.md` (`DATABASE_URL` must be the transaction pooler URL; set `ADMIN_EMAILS` and `ADMIN_HOST`). Ask needs `CLAUDE_API_KEY` for answers and `GEMINI_API_KEY` for question embeddings; `GEMINI_MODEL` is not read by web.
- PWA icons live in `apps/web/public` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and are referenced by `src/app/manifest.ts`.

## Still to do

- Vercel project for `apps/web` + env vars + domains `reelset.app`, `admin.reelset.app`
- Secrets: `GEMINI_API_KEY` (embeddings only), `CLAUDE_API_KEY` (scripts and image vetting), `GITHUB_TOKEN`, `ALERT_WEBHOOK_URL`; render worker `PEXELS_API_KEY` (`unset CLOUDFLARE_API_TOKEN; wrangler secret put PEXELS_API_KEY` in `workers/render`; without it reels render without stock b-roll)
- Fill `HYPERDRIVE` id in both `wrangler.jsonc` files, then `wrangler deploy` ingest + render

## Render box (Oracle)

Rendering and Instagram posting run on an Oracle Always Free Ampere A1 VM (arm64, 2 OCPU / 12 GB, Ubuntu 24.04) instead of Cloudflare Containers. The image comes from `workers/render/container`, built by `.github/workflows/render-image.yml` on the native arm runner and pushed to `ghcr.io/reelset/reelset-render` (`latest` + commit sha).

- Path: render Worker -> `https://box.reelset.app` (Cloudflare Tunnel, outbound only, no inbound ports) -> `render:8080`, with `Authorization: Bearer <BOX_TOKEN>`. `GET /health` is the only unauthenticated route.
- Box env (`/etc/reelset/box.env`): `BOX_TOKEN`, `PROXY_URLS`, `TUNNEL_TOKEN`, `MAX_RENDERS` (default 1), `REEL_CONCURRENCY` (Remotion tabs, default 2).
- Concurrency: `MAX_RENDERS` renders at once; extra `POST /render` get `409 {"error":"busy"}` and the Worker retries. Instagram ops are serialized the same way.
- Setup, update timer and verification steps: `scripts/box/README.md`.

## Narration engines (render container)

Chain: Aura-2 + Nova-3 (Workers AI, `tts_provider=aura2`) -> Kokoro in the container -> edge-tts. Any Aura failure falls back on the same delivery. Settings: `tts_provider` accepts `edge` (default), `aura2`, `kokoro` (no database change; it is a JSON value in `app_setting`).

- Kokoro files are baked into the image at build from `github.com/thewh1teagle/kokoro-onnx` release `model-files-v1.1` into `/opt/kokoro` (`KOKORO_MODEL_DIR`), each pinned by `ADD --checksum=sha256:...` in per-arch Dockerfile stages chosen by `TARGETARCH` (buildx sets it). amd64: `kokoro-v1.0.fp16.onnx` (164 MB, `f3a290d3...ac96`). arm64: `kokoro-v1.0.onnx` fp32 (326 MB, `beb0d184...f0df3a`). Both: `voices-v1.0.bin` (28 MB, `bca610b8...bf7d`). The build needs outbound access to GitHub; a hash mismatch fails the build. Python deps (`kokoro-onnx`, `onnxruntime`, `numpy`, `espeakng-loader`, `phonemizer`) are pinned in `container/requirements.txt`; wheels exist for linux x86_64 (manylinux_2_28) and aarch64.
- Why fp16 on amd64, not int8: int8 loses 6-7 dB of 6-11.5 kHz energy against fp32 (muffled narration); fp16 matches fp32 (-13.7 vs -13.9 dB HF ratio). Use the v1.1 files: the v1.0 release files have no `duration` output, so there are no phoneme timings and Kokoro raises (the v1.1 fp32 file has `waveform` + `duration`).
- Why fp32 on arm64: onnxruntime 1.24.1 through at least 1.31.1 on linux aarch64 returns all-NaN audio for fp16 models (works on macOS arm64, linux x86_64 and onnxruntime 1.23.2; upstream: microsoft/onnxruntime#32600, KleidiAI fp16 CPU kernels from #29709). fp32 does not use those kernels. `kokoro_tts.model_file()` picks the file by `platform.machine()`; the image only contains the matching one. Revisit (fp16 everywhere) once onnxruntime fixes it.
- Guard: `kokoro_tts.assert_audible` raises `KokoroError` for empty, NaN/inf or silent (peak < 1e-3) audio on every render, so a regression falls back to edge-tts visibly (`kokoro failed` log) instead of shipping broken narration.
- CI proof: `.github/workflows/render-image.yml` builds on the native `ubuntu-24.04-arm` runner, loads the image, runs `python -m reel.kokoro_smoke` in it (real Kokoro synthesis, fails on NaN/silence/fallback), and only then pushes to GHCR, so a broken image is never tagged `latest`.
- Level: `encode_mp3` applies `loudnorm=I=-15:TP=-1.5` (raw Kokoro is about -26.6 LUFS, Aura about -14.6); `reel/mix.py` still normalizes the voice to -16 LUFS and masters to -14, so the mix sees the same level for every engine.
- Local smoke (v14 paper script, 110 tokens, linux/amd64 under emulation, 2 CPUs): 57.0 s of audio, -16.4 LUFS, 110 timed words for 110 tokens, 52.6 s wall (two passes), 24 kHz mono 128k mp3. Model load about 2-3 s once per process; container RSS about 1 GB. Not measured on the Cloudflare `standard-3` instance. Image 3.35 GB.
- Rollback: set `tts_provider` to `edge` (the worker then sends `ttsEngine: edge` and Kokoro never runs). A missing or unloadable model only makes Kokoro raise, and edge-tts takes over for that render.

## Script LLM: Claude (model picked in /admin/settings)

Scripts and image vetting run on Claude only (Gemini credits were depleted: HTTP 402 paused the pipeline); Gemini is kept for embeddings. The `LLM_PROVIDER` switch was removed. Setup:

```bash
cd workers/ingest
unset CLOUDFLARE_API_TOKEN
wrangler secret put CLAUDE_API_KEY          # paste the key from reelset/.env.local
# models are not env vars: script_model, script_effort and image_vet_model live in app_setting
wrangler deploy
```

Embeddings keep using `GEMINI_API_KEY`, so they need Gemini credits regardless. Offline check without touching the database: `npx tsx --env-file=.env.local scripts/maintenance/gen-claude-samples.ts <outDir> <slug>=<itemId> ... [--model claude-haiku-5-5|claude-sonnet-5-5|claude-opus-5-5] [--effort low|medium|high] [--dry]` (live Claude calls, writes script, usage, cost and brief per item as JSON; `--dry` only writes the prompt). Regenerating stored scripts: `scripts/maintenance/regen-scripts.ts`.

## Template upgrade sweep and ingest gating

- The render cron's template-upgrade sweep (re-renders already rendered items on the newest template) is off unless `app_setting` `render_upgrade_enabled` is `true` (`scripts/maintenance/set-setting.ts renderUpgradeEnabled true`). New items always render on the current template through the queue. `feed_min_template` stays 6 until the old reels are deliberately retired.
- Template 8 renders take 7-12 minutes on a 2 vCPU machine (Pexels b-roll vetting plus Remotion), so the first queue attempt can time out; the retry returns the box's cached result.
- The ingest pipeline pause probe is a Gemini embedding call. While Gemini prepay credits are depleted (HTTP 402) the pause is renewed every probe and no new items are scripted. Top up Gemini credits to resume ingest.

## Render container fonts and image

- The image installs `fonts-noto-cjk` (SIL OFL) and deletes every weight except `NotoSansCJK-Regular.ttc` and `NotoSansCJK-Bold.ttc` in the same layer (about 40 MB); Remotion's font stacks (`theme.ts` `FONT`, `MONO`) fall back to it after Geist.

## Render worker behavior worth knowing

- Narration: ingest keeps scripts to 100-112 words / 760 spoken characters; the worker rounds long decimals before TTS, retries Aura up to 2 times on shorter scripts, then Kokoro (pause-aware speed refit), then edge-tts. Check `spend_ledger` rows with `category = 'tts'` (`meta.provider`) to see which engine each reel used.
- `markRetryPending` (render consumer): while a retry is waiting the render row is `queued`, not `rendering`, so the 20-minute stuck reaper does not fail it. The item title is clamped to 200 characters before the container call.
- Deploy render only when no render row is `rendering` and the `render-jobs` queue is empty, otherwise in-flight jobs are orphaned. The deploy needs no Docker: renders run on the box, not in a Cloudflare Container (`ReelContainer` was deleted by migration `v2`).
- Worker -> box: the worker is a plain client of the render box at `RENDER_BOX_URL` (`https://box.reelset.app`, Cloudflare Tunnel) with `Authorization: Bearer RENDER_BOX_TOKEN` (`src/box-fetcher.ts`; the `http://container/<path>` URLs are rewritten onto it). `GET /health` is open. The `render-jobs` consumer runs `max_batch_size 1`, `max_concurrency 1`; the box renders `MAX_RENDERS` (default 1) at a time and answers 429 (409 also accepted) `{"error":"busy"}` otherwise.
- Busy box: a busy answer does not burn the retry budget. The consumer releases the render row to `queued` and re-sends a fresh `render-jobs` message `{itemId, deferrals}` with a 45 s delay (max 160 deferrals, about 2 h, then normal retries and failure). Cloudflare answers a tunnel request that stays silent for 100 s with 524; that is treated as busy too, because the box keeps rendering and the next poll gets `busy` (still running) or the cached result (`done`, kept 30 min). Renders are one long `POST /render` (client timeout 14 min under the 15 min queue wall limit); the busy poll is what keeps a slow box from stranding renders (`STUCK_RENDER_MINUTES` 30 only reaps rows stuck in `rendering`).
- `PROXY_URLS` is a box env var now (the worker no longer forwards it).
- B-roll: Pexels cache keys in R2 `cache/pexels/`: `search-30-<sha1>.json` (7 days), `rate.json`, `usage.json` (all-time clip counts), `recent.json` (clip ids of the last 8 reels).

## Instagram posting (server side)

Admin (`/admin/instagram`) queues rows in `instagram_post`; the render worker posts them through instagrapi running on the render box. Nothing runs on a laptop.

- Flow: admin "Queue post" inserts a `queued` row, then pokes `POST https://render-api.reelset.app/admin/ig/run`. The poke and the 5-minute cron only send a message to the `instagram-run` queue; its consumer (one run at a time, up to 15 minutes) claims one row with `FOR UPDATE SKIP LOCKED`, at least 10 minutes after the previous attempt, calls the container `/instagram/post` (video URL plus the render's poster URL, which becomes the reel cover so Instagram matches the app; a video frame is used only if the poster is missing or unusable), and writes `posted` (media_pk, permalink) or `failed`. Never run the upload in a fetch's `waitUntil`: it is cut about 30s after the response while an upload takes 30-60s, which left reels live on Instagram but stuck in `posting`. A row stuck in `posting` for 10 minutes is failed as lost, never re-sent; each run then looks up one lost row (up to 3 days old) through the container `/instagram/find` (the account's 12 newest media: same caption published after `started_at`, else the video published soonest after it within 30 minutes that no other post has recorded, because Instagram can publish a reel without its caption): found becomes `posted` with its media_pk and permalink, not found reads "safe to queue it again", a failed lookup retries next run. A reel that comes back from Instagram without the caption we sent (seen on a caption with a long link) gets it restored once with `media_edit`, after upload and when a lost reel is found; a failed restore never fails the post. Delete requests (`delete_requested_at` on a `posted` row) go through `/instagram/delete`.
- Public surface: the worker has a custom domain `render-api.reelset.app` (DNS on Cloudflare, created by `wrangler deploy`). Only `POST /admin/ig/{status,connect,run}` answer there, each needs `Authorization: Bearer IG_ADMIN_TOKEN` (constant-time check, 404 otherwise). The internal routes (`/transcript`, `/youtube/search`, `/parse/paper`) only answer for the `render.internal` service-binding host.
- Worker secrets: `IG_ADMIN_TOKEN`, `IG_SESSION_KEY` (32 random bytes, base64), `IG_USERNAME`, `IG_PASSWORD`, optional `IG_TOTP_SECRET`. `RENDER_BOX_TOKEN` (secret) is the box bearer token; `PROXY_URLS` lives on the box. Vercel env: `IG_ADMIN_URL`, `IG_ADMIN_TOKEN`. Values live in `reelset/.env.local`.
- Session: instagrapi settings (session + device ids) plus the pinned proxy index are AES-GCM encrypted by the worker and stored in `app_setting` key `ig_session_enc`; the account card state is `app_setting` `ig_account` (no secrets). Seed from a local login with `npx tsx --env-file=.env.local scripts/maintenance/seed-ig-session.ts` (reads `~/.reelset/ig_session.json`, prints nothing sensitive).
- Logins: only the admin "Connect" click logs in (one attempt, 2FA code typed in admin). Status checks and posts reuse the session and never log in. After 3 failed logins the card recommends the official Graph API.
- Proxy: all instagrapi traffic goes through one pinned entry of `PROXY_URLS`. Before every call the container fetches an IP-echo endpoint through it; if the pinned proxy is dead it uses the other one (flagged "backup proxy in use") and if none answers the call is blocked with `proxy_down`. It never falls back to the direct Cloudflare IP. Risk: the proxies are datacenter IPs and Instagram flags datacenter ranges, and the saved session was created from a home IP, so the first call from the proxy can trigger a challenge.
- Deploy: `scripts/maintenance/deploy-render.sh` (uploads the IG secrets and `RENDER_BOX_TOKEN` from `.env.local` with the worker version; first deploy also creates the `render-api.reelset.app` custom domain; no Docker build).
- Box capacity: Instagram calls share the one box with renders and are not limited by `MAX_RENDERS`, so a post during a render competes for the 2 cores.
- Container route contract: `POST /instagram/{status,login,post,delete}` with `{session, proxyIndex, ...}`; replies include `proxy {index, country, switched, down}`; the container keeps no state and logs no credentials.

## Northflank box power (replaces the Oracle VM)

- The render container runs as a Northflank deployment service `render-box` (nf-compute-200: 2 vCPU / 4 GB, 1 instance, public HTTP port 8080, health check `/health`, image `ghcr.io/reelset/reelset-render:latest`, multi-arch amd64 + arm64; Northflank runs amd64). `RENDER_BOX_URL` is its `*.code.run` URL; `BOX_TOKEN`, `PROXY_URLS`, `MAX_RENDERS` are service runtime env.
- Auto power: the render worker (`src/box-power.ts`) calls the Northflank API (`NORTHFLANK_API_TOKEN` secret, `NORTHFLANK_PROJECT_ID`, `NORTHFLANK_SERVICE_ID` vars). A paused/booting box (connection failure, or the empty-bodied 503 a paused service returns) triggers `resume` (debounced 60 s, skipped if the service is already running) and reads as `busy`, so the consumer defers the job 45 s. `/transcript`, `/youtube/search`, `/parse/paper` return 503 meanwhile; ingest retries transcripts with backoff (30/60/120 s) and degrades paper parsing to plain text.
- The `*/5` cron reads `GET /health` (`{ok, running, inflight, idleSeconds}`) and pauses the service when `running == 0 && inflight == 0 && idleSeconds >= 600`. An unreachable box is left alone.
- Cost: billed per second only while running, `CONTAINER_USD_PER_SECOND` = 2 vCPU x $0.01667/h + 4 GB x $0.00833/h.
- Paused state is `data.deployment.instances == 0` in `GET /v1/projects/{p}/services/{s}` (there is no `servicePaused` field). Project `default`, service `render-box`; resume to first `/health` 200 took about 76 s.
- Free sandbox projects only accept plan `nf-compute-20` (0.2 vCPU / 512 MB, 2 GB ephemeral, no custom shm); larger plans are rejected with "exceeds your free project deployment resource allowance".
