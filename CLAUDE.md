# reelset

"TikTok for developers": a swipe feed where every item (GitHub repo, HN/Reddit thread, YouTube video, news) is an auto-generated vertical reel, plus an AI "Ask" box with cited answers.

## Layout

- `packages/core` — Prisma schema + migrations, generated Kysely types, `createDb`, logger, domain rules (source enum, item status machine, render key, embeddings), `transitionItem`. Every other package imports `@reelset/core`.
- `workers/ingest` — Cloudflare Cron + Queues: fetch sources, normalize, dedupe, score, LLM TLDR + reel script, embed.
- `workers/render` — Cloudflare Queue consumer + Container (`workers/render/container`: youtube-transcript-api, edge-tts, FFmpeg) -> MP4 in R2.
- `apps/web` — Next.js PWA on Vercel: feed, auth (Supabase), likes, /api/ask, /api/events, /admin.

## Rules

- Database: Supabase Postgres via `DATABASE_URL` in `reelset/.env.local` (git-ignored). Never print, log or commit connection strings or keys.
- Schema changes only in `packages/core/prisma/schema.prisma` + a new migration. Vector columns are `Unsupported("vector(768)")` and are not in Kysely types: use the helpers in core (`setItemEmbedding`, `toVectorLiteral`) or raw `sql`. Never let a migration drop the `*_hnsw_idx` indexes or disable RLS.
- Item status changes only through `transitionItem` (it records `item_event` rows and guards against duplicate deliveries).
- Sources are the strict enum `hn | github | news | reddit | youtube | papers`; reject anything else with `parseSource`.
- **No frontend tests** (no Playwright/Cypress/React component tests). Test backend, API-route logic and pipeline code with Vitest. Mock all external HTTP in tests.
- Style: TypeScript strict, no semicolons, single quotes, width 100 (`.prettierrc`). Avoid comments except non-obvious why. Log at edges and decision points with pino child loggers carrying ids (itemId, runId, source); never log secrets.
- Commands: `npm test`, `npm run typecheck`, `npm run db:check` (from repo root).
