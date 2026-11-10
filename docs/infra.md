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
- Env vars: see the web list in `docs/contracts.md` (`DATABASE_URL` must be the transaction pooler URL; set `ADMIN_EMAILS` and `ADMIN_HOST`).
- PWA icons live in `apps/web/public` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and are referenced by `src/app/manifest.ts`.

## Still to do

- Vercel project for `apps/web` + env vars + domains `reelset.app`, `admin.reelset.app`
- Secrets: `GEMINI_API_KEY` (embeddings, image vetting, and scripts while `LLM_PROVIDER=gemini`), `CLAUDE_API_KEY` (scripts when `LLM_PROVIDER=anthropic`), `GITHUB_TOKEN`, `ALERT_WEBHOOK_URL`; render worker `PEXELS_API_KEY` (`unset CLOUDFLARE_API_TOKEN; wrangler secret put PEXELS_API_KEY` in `workers/render`; without it reels render without stock b-roll)
- Fill `HYPERDRIVE` id in both `wrangler.jsonc` files, then `wrangler deploy` ingest + render

## Narration engines (render container)

Chain: Aura-2 + Nova-3 (Workers AI, `tts_provider=aura2`) -> Kokoro in the container -> edge-tts. Any Aura failure falls back on the same delivery. Settings: `tts_provider` accepts `edge` (default), `aura2`, `kokoro` (no database change; it is a JSON value in `app_setting`).

- Kokoro files are baked into the image at build: `ADD --checksum=sha256:...` of `kokoro-v1.0.fp16.onnx` (164 MB, sha256 `f3a290d3...ac96`) and `voices-v1.0.bin` (28 MB, `bca610b8...bf7d`) from `github.com/thewh1teagle/kokoro-onnx` release `model-files-v1.1` into `/opt/kokoro` (`KOKORO_MODEL_DIR`). The build needs outbound access to GitHub; a hash mismatch fails the build. Python deps (`kokoro-onnx`, `onnxruntime`, `numpy`, `espeakng-loader`, `phonemizer`) are pinned in `container/requirements.txt`; wheels exist for linux x86_64 (manylinux_2_28) and aarch64.
- Why fp16, not int8: int8 loses 6-7 dB of 6-11.5 kHz energy against fp32 (muffled narration); fp16 matches fp32 (-13.7 vs -13.9 dB HF ratio). Use the v1.1 fp16 file: the v1.0 fp16 file has no `duration` output, so there are no phoneme timings and Kokoro raises. Caveat: onnxruntime 1.31.1 on linux aarch64 returns all-NaN audio for fp16 (works on macOS arm64 and linux x86_64, the Cloudflare target); on an arm64 Docker host Kokoro therefore fails over to edge-tts. Verify Kokoro locally with `--platform linux/amd64`.
- Level: `encode_mp3` applies `loudnorm=I=-15:TP=-1.5` (raw Kokoro is about -26.6 LUFS, Aura about -14.6); `reel/mix.py` still normalizes the voice to -16 LUFS and masters to -14, so the mix sees the same level for every engine.
- Local smoke (v14 paper script, 110 tokens, linux/amd64 under emulation, 2 CPUs): 57.0 s of audio, -16.4 LUFS, 110 timed words for 110 tokens, 52.6 s wall (two passes), 24 kHz mono 128k mp3. Model load about 2-3 s once per process; container RSS about 1 GB. Not measured on the Cloudflare `standard-3` instance. Image 3.35 GB.
- Rollback: set `tts_provider` to `edge` (the worker then sends `ttsEngine: edge` and Kokoro never runs). A missing or unloadable model only makes Kokoro raise, and edge-tts takes over for that render.

## Switching the script LLM to Claude Haiku 5.5

Production runs `LLM_PROVIDER=anthropic` (Gemini credits were depleted: HTTP 402 paused the pipeline); the code default is still `gemini`. The switch was:

```bash
cd workers/ingest
unset CLOUDFLARE_API_TOKEN
wrangler secret put CLAUDE_API_KEY          # paste the key from reelset/.env.local
# in wrangler.jsonc vars: "LLM_PROVIDER": "anthropic", "LLM_MODEL": "claude-haiku-5-5", "LLM_EFFORT": "medium" (committed; production runs this)
wrangler deploy
```

Roll back by setting `LLM_PROVIDER` back to `gemini` in `workers/ingest/wrangler.jsonc` and redeploying. Embeddings and image vetting keep using `GEMINI_API_KEY` either way, so those need Gemini credits regardless. Offline check without touching the database: `npx tsx --env-file=.env.local scripts/maintenance/gen-claude-samples.ts <outDir> <slug>=<itemId> ... [--effort low|medium|high] [--dry]` (live Claude calls, writes script, usage, cost and brief per item as JSON; `--dry` only writes the prompt). Regenerating stored scripts: `LLM_PROVIDER=anthropic scripts/maintenance/regen-scripts.ts`.

## Template upgrade sweep and ingest gating

- The render cron's template-upgrade sweep (re-renders already rendered items on the newest template) is off unless `app_setting` `render_upgrade_enabled` is `true` (`scripts/maintenance/set-setting.ts renderUpgradeEnabled true`). New items always render on the current template through the queue. `feed_min_template` stays 6 until the old reels are deliberately retired.
- Template 8 renders take 7-12 minutes on the `standard-3` container (Pexels b-roll vetting plus Remotion), so the first queue attempt can time out; the retry returns the container's cached result.
- The ingest pipeline pause probe is a Gemini embedding call. While Gemini prepay credits are depleted (HTTP 402) the pause is renewed every probe and no new items are scripted, whatever `LLM_PROVIDER` is. Top up Gemini credits to resume ingest.
