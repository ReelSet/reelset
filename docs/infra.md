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
- Workers (not deployed yet): `reelset-ingest`, `reelset-render`

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
- Secrets: `GEMINI_API_KEY`, `GITHUB_TOKEN`, `ALERT_WEBHOOK_URL`; render worker `PEXELS_API_KEY` (`unset CLOUDFLARE_API_TOKEN; wrangler secret put PEXELS_API_KEY` in `workers/render`; without it reels render without stock b-roll)
- Fill `HYPERDRIVE` id in both `wrangler.jsonc` files, then `wrangler deploy` ingest + render
