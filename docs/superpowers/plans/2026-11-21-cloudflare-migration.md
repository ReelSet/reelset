# Plan: cut web CPU and move apps/web from Vercel to Cloudflare Workers (2026-11-21)

Branch `cloudflare-migration`. Do not push. Paths are relative to the repo root; `W` = `apps/web/src`.

## Goal and end state

- Vercel Hobby paused the project on 2026-11-21: Fluid Active CPU went over 4 h. reelset.app and admin.reelset.app now return 402. Traffic is crawler-shaped, a flat 100-200 requests per bucket all day.
- When we are done, both hosts are served by the Worker `reelset-web`, built with `@opennextjs/cloudflare` on Workers Paid. Every feature works:
  - feed, `/r/[slug]`, `/t`, `/t/[topic]`
  - Ask with Claude streaming
  - likes, saves, views and events
  - login, callback and logout on the `.reelset.app` cookie domain
  - profile and avatar upload, without sharp
  - generate/create and `/api/mcp`
  - all admin pages, including Instagram insights
  - sitemap, robots, llms.txt, llms-full.txt, OG images and the PWA manifest
- A crawler hit on a public URL is served from cache, at about 1-5 ms CPU.

## Decisions (one line each)

1. **OpenNext, not vinext.** OpenNext runs the real `next build` and is mature. vinext is a beta reimplementation.
2. **Bump `next` to `16.4.6`.** `@opennextjs/cloudflare@1.20.18` requires `next >=16.4.5`, and no adapter version supports 16.2.
3. **Keep `proxy.ts`.** Node middleware has been supported since 1.20.3. If the build or runtime fails, fall back to `middleware.ts` with `runtime: 'experimental-edge'`; the code uses only Web APIs.
4. **ISR cache.** R2 incremental cache in a new bucket `reelset-next-cache`, wrapped in `withRegionalCache` (long-lived), plus DO queue and `enableCacheInterception`. A separate bucket keeps cache churn out of `reelset-media`. Interception serves cache hits without loading NextServer.
5. **D1 tag cache (`d1NextTagCache`, DB `reelset-next-tags`).** An admin takedown must drop the public `/r/<slug>` page at once, not after up to 1 h of ISR. D1 reads are I/O, not CPU.
6. **Small Cache-API wrapper, allowlisted paths only.** It wraps the OpenNext handler for `/api/reel/*`, `/api/avatar/*`, `/api/showcase/*`, `/llms.txt` and `/llms-full.txt`. On Workers the Worker is the origin, so `s-maxage` is otherwise ignored. ISR HTML stays on OpenNext's cache so revalidation stays correct.
7. **DB resolution order: per-request Hyperdrive client, then `process.env.DATABASE_URL` (Node only).** Workers cannot share I/O across requests. The fallback serves `next dev`, Vitest and build-time prerenders; for the build it is the Supabase pooler URL, which is IPv4.
8. **Avatars stay `bytea` and are served through the edge-cached `/api/avatar/[id]`.** Moving them to R2 would need a schema migration and buys little once the route is cached. sharp is replaced by client-side WebP (it already exists) plus a server WebP header check.
9. **`images.unoptimized: true`.** Posters on R2 are already sized, and `/_next/image` on Workers would bill a Worker call plus Images transformations.
10. **Remove `@vercel/analytics`.** `/_vercel/insights` would 404 through the Worker. Turning on Cloudflare Web Analytics at the zone is optional and needs no code.
11. **Public pages render anonymous content only.** Per-user state (liked, saved, following, avatar, signed-in CTA) is fetched on the client when a non-httpOnly hint cookie `rs_auth=1` is present. This is what makes the shells cacheable.
12. **`?topic=` and `?source=` are read on the client.** Reading `searchParams` on the server makes a page dynamic. Variants get a canonical tag pointing at the base URL plus a `Disallow` in robots, so crawlers stop walking the combinatorial URL space.
13. **Service bindings `INGEST` -> `reelset-ingest` and `RENDER` -> `reelset-render`, with URL fallback.** This skips the public hop and the 524 risk on long Instagram connect and gate-judge calls.
14. **`limits.cpu_ms: 10000`.** This is a cost guard: a runaway render fails fast. The heaviest legitimate path (an OG render) is about 300 ms.
15. **Leave the Vercel project untouched.** Do not delete it or its domains; it is the rollback target.
16. **Deploy from local with `npm run deploy -w @reelset/web`.** Workers Builds CI would need build secrets duplicated in the dashboard. Adding CI is a follow-up.

## Risks

- **Experimental Node middleware.** Mitigation: the decision 3 fallback, tested in `preview`.
- **Bundle size.** The safe budget is 10 MiB gzip; og wasm takes about 0.5 MiB. Check `Total Upload` from the deploy dry run.
- **MCP SDK uses AJV, and `new Function` is blocked on Workers.** Use the cfworker validator.
- **Magic-link login cannot be tested on workers.dev**, because the redirect URL is not allowed and the cookie domain does not match. Auth is verified after cutover, using existing `.reelset.app` session cookies in the browser.
- **The Cache API is a no-op on `*.workers.dev`.** Edge-cache HITs can only be verified on the custom domains.
- **wrangler OAuth has no DNS scope.** Cutover uses Workers Custom Domains, which replaces DNS records itself, with dashboard fallback. See Part D.
- **Next 16.2 -> 16.4 may change APIs.** Run the typecheck and the full test suite right after the bump.

---

## Part A: host-agnostic CPU optimizations (done first, one commit per numbered step)

Run `npm run typecheck && npm test` after every step.

**A0. Next bump.**

- In `apps/web/package.json`, set `"next": "16.4.6"` and run `npm install` at the root.
- Fix any type errors.
- Commit: "Bump Next to 16.4.6".

**A1. Stop minting `rs_sid` in the proxy.**

- In `W/proxy.ts`, delete the `parseSessionId` / `SESSION_COOKIE` block and its now-unused imports.
- `W/app/api/events/route.ts` and `W/app/api/views/route.ts` already mint the cookie; check that they still set it when it is missing.
- Readers of the cookie: only `lib/session.ts`, `api/events` and `api/views`.
- Result: anonymous responses carry no Set-Cookie, so they can be cached.

**A2. Lean, narrow proxy.**

- In `W/proxy.ts`:
  - Read `ADMIN_HOST` inside the function, not at module scope.
  - Extend the matcher negative lookahead with: `sitemap.xml`, `robots.txt`, `llms.txt`, `llms-full.txt`, `.*opengraph-image.*`, `api/reel`, `api/avatar`, `api/views`, `api/feed`, `api/ask`, `apple-icon.png`, `icon-.*\\.png`.
- Auth refresh: replace `supabase.auth.getUser()` with a helper `shouldRefresh(authCookies, now)` in a new file `W/lib/auth/token-exp.ts`.
  - The helper decodes the `sb-*-auth-token` cookie, which may be chunked `.0`/`.1` and may carry a `base64-` prefix, and reads the access token's `exp`.
  - It returns true when `exp - now < 300 s` or when the cookie cannot be parsed.
  - Call `getUser()` only when it returns true; otherwise return early, leaving the domain-migration marker logic intact.
- Vitest: `W/lib/auth/token-exp.test.ts` covers fresh, near-expiry, expired, chunked and garbage cookies.

**A3. Deduplicate auth per render.**

- In `W/server/auth.ts`, wrap `getOptionalUser` and the role lookup (`getUserRole` / `requireAdmin` internals) in React `cache()`.
- Switch `getUser()` to `getClaims()`. It verifies the JWT locally when the project uses asymmetric keys and falls back to a network call otherwise. Map the claims to `AuthUser` (`sub` -> id, `email`).
- Make sure that `W/app/admin/layout.tsx` and each admin page calling `assertAdmin` now run the auth and role check once per request.

**A4. Anonymous ISR home and reel pages.**

- `W/app/(reader)/page.tsx`:
  - Remove `force-dynamic`, `cookies()`, `getOptionalUser` and the `searchParams` read.
  - Add `export const revalidate = 300`.
  - Render the anonymous first page from a new `cachedAnonFeed()` in `W/server/seo-cache.ts`: `unstable_cache` keyed on `['anon-feed', focusId ?? '']`, `revalidate: 60`, built on `loadFeedResponse` with `profileId: null`.
- `W/app/r/[slug]/page.tsx`:
  - Same removals.
  - Add `revalidate = 3600`, `dynamicParams = true` and `generateStaticParams = async () => []`.
  - `generateMetadata` no longer reads searchParams. Canonical is always `/r/<slug>`, and the noindex-for-variants logic is removed.
  - Load the focus item through `cachedAnonFeed(focusId)`.
  - Tag the page with `reel:<itemId>` via `unstable_cache` tags, so takedowns can revalidate it (B6).
- `W/components/feed/FeedClient.tsx`:
  - Read `topic` and `source` through `useSearchParams`, inside a `<Suspense>` in the pages. When they are set, or the `rs_auth` hint cookie is present, refetch `/api/feed?...` for the filtered or personalized page and liked/saved state.
  - Fold the `/api/feed/following` call into the same branch, so anonymous users skip it.
- `W/lib/feed/*` DTO: drop `transcript` from the initial `FeedItemDto`. It is lazy-loaded through `/api/reel/[id]` (`useReelDetails`). Update the Vitest tests that assert the DTO shape.
- `W/server/feed.ts`:
  - Use `cachedTopicLabels` instead of `listTopicLabels`.
  - Batch `loadCountRules` into one `where key in (...)` query, or use `cachedCountRules`.
  - Memoize `loadFeedMinTemplate` per call chain: pass it from `rankFeed` into `getFeedItem`.
- Hint cookie `rs_auth=1`:
  - Set it (non-httpOnly, shared domain, same max-age as auth) in `W/app/auth/callback/route.ts` and wherever the session is established.
  - Clear it in the logout route.
  - Put helpers next to `serializeCookie` in `W/lib/auth/cookie-options.ts`, with a Vitest test for the serialization.

**A5. Topic pages ISR.**

- `W/app/t/page.tsx`: remove `force-dynamic` and add `revalidate = 300`.
- `W/app/t/[topic]/page.tsx`: also add `generateStaticParams = async () => []` and `dynamicParams = true`.
- `?source=` filtering moves to a small client filter over the rendered cards. Server code no longer reads searchParams.
- `W/app/t/layout.tsx`, `W/app/pricing/layout.tsx`, `W/app/mcp/layout.tsx`: `AppShell` no longer calls `getViewer`. It renders without an avatar, and the client `useNavAvatar` (`W/components/ui/AppNav.tsx`) fills it in when `rs_auth` is present.

**A6. Static marketing pages.**

- `W/app/pricing/page.tsx`, `W/app/mcp/page.tsx`, `W/app/create/page.tsx`, `W/app/(reader)/ask/page.tsx`:
  - Remove `force-dynamic` and the server-side signed-in checks.
  - Make the `signedIn` CTA a client component that reads `rs_auth`.
  - Render the pricing reset time with `LocalTime`.
  - Add `revalidate = 3600` where the page reads data (ask suggestions).
- `W/app/login/page.tsx` plus `LoginForm`: read `next` and `error` through `useSearchParams` and keep the page static. `/create` keeps its server-side auth gate only if it redirects; in that case it stays dynamic and that is acceptable.

**A7. Sitemap and llms.**

- `W/app/sitemap.ts`: remove `force-dynamic` and add `revalidate = 3600`.
- Add a lean `listSitemapReels(db, limit)` to `W/server/seo-queries.ts`. It selects id, slug fields, title, tldr, updated_at, poster_key, video_key and duration, with no `leadSource` and no view_count.
- Give `listReelSummaries` an `{ withLeadSource }` flag (default true) and pass false from llms.
- `W/app/llms.txt/route.ts` and `W/app/llms-full.txt/route.ts`: remove `force-dynamic` and add `revalidate = 3600`.
- Vitest: `buildSitemap` from lean rows, and the query builder compiled to SQL against the dummy db.

**A8. OG images.**

- `W/app/r/[slug]/opengraph-image.tsx`:
  - Add `revalidate = 86400` and `generateStaticParams = async () => []`.
  - Replace `loadReelPage` with a new minimal `loadOgFields(db, slug)` (title, topics, canonical_url, poster_key).
- Delete `W/app/r/[slug]/twitter-image.tsx`. In `generateMetadata`, set `twitter: { card: 'summary_large_image', images: [ogUrl] }`.
- Fonts: load them as `fetch(new URL('./font.ttf', import.meta.url))` or as static assets, not `readFile(process.cwd())`.
- Root `W/app/opengraph-image.tsx` stays static. Confirm `○` in the build output.

**A9. Robots.** In `W/app/robots.ts`, add `disallow: ['/*?*topic=', '/*?*source=', '/api/', '/admin']` to every rule. Keep the AI crawler allowlist; caching makes those crawlers cheap.

**A10. TimeZoneSync.** In `W/components/TimeZoneSync.tsx`, call `router.refresh()` only when `pathname` starts with `/admin` or `/profile`. Public times use `LocalTime`.

**A11. Admin polling.**

- `W/components/admin/pipeline/AutoRefresh.tsx`:
  - Default interval 30 s.
  - Pause after 5 min without pointer or keyboard input, and when `document.hidden`.
  - Resume on input.
- `W/components/admin/drawer/AdminDrawerProvider.tsx`: poll every 30 s, and only while the item status is non-terminal (`rendered | failed | hidden` stop it).

**A12. Hot-path logs and cache headers.**

- Downgrade per-hit success logs in `rankFeed`, `loadReelPage` and the topic pages to `debug`.
- `W/app/api/reel/[id]/route.ts`: `Cache-Control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800`.
- `W/app/api/avatar/[id]`: keep it immutable with a versioned URL.

**A13. Remove Vercel analytics.** Remove `<Analytics />` from `W/app/layout.tsx` and drop `@vercel/analytics` from `apps/web/package.json`.

### Part A: as built (2026-11-21)

Done in commits 7631ca0..193a620. Checked locally with `next build` and `next start`: every
public route is `○`/`●` ISR and sends no Set-Cookie. Changes from the plan above:

- **Build-time DB.** `db.<ref>.supabase.co` is IPv6-only and does not resolve here. The pooler
  that works is `aws-1-us-west-2.pooler.supabase.com:6543`, user `postgres.<ref>` (transaction
  mode). Part C can use it directly without probing.
- **A2.** The proxy also keeps the `rs_auth` hint in sync. It sets the hint when `sb-*` cookies
  exist without it, and clears it when it is present with no session, so sessions from before
  this change get the hint.
- **A3.** `getOptionalUser` and `getUserRole` use React `cache()`. The JWKS cache in auth-js is
  module-global (plain data), so it is safe on Workers.
- **A4, query reading.** `?topic=`/`?source=` are read from `window.location` after mount, not
  from `useSearchParams` in `<Suspense>`. Suspense would have dropped the whole feed and the
  `ReelPanel` out of the server HTML.
- **A4, caching.**
  - `unstable_cache` lowers the page's revalidate to its own and adds its tags to the page.
    So the anonymous feed is cached per page period: 300 s on `/`, 3600 s on `/r/*`.
  - The reel page combines that one shared anonymous page with `cachedFocusItem(id)`, so it
    does not rank once per slug.
  - Tags: `reel:<shortid>` (`reelTag()` in `lib/cache-tags.ts` accepts a uuid or a short id)
    on the reel page, the OG fields and the focus card, and `feed` (`FEED_TAG`) on the
    anonymous feeds. B6 should call `revalidateTag(reelTag(id))` and `revalidateTag(FEED_TAG)`.
  - `/api/feed` takes `?focus=<uuid>` for the signed-in refetch on `/r/*`.
- **A5.** `?source=` stays exact instead of becoming a filter over rendered cards (cards only
  know their lead source, and shelves and counts depend on the source).
  - `proxy.ts` rewrites `/t?source=s` to `/t/by/s` and `/t/<topic>?source=s` to
    `/t/<topic>/by/s` (`lib/source-path.ts`). Those routes are separate ISR pages that
    validate with `parseSource` and redirect unknown values to the base page.
  - The `seo-cache` period went from 60 s to 300 s to match the pages.
  - `AppShell` is now static. `ViewerAppShell` (server avatar) is kept for `/profile` and
    `/create`.
- **A6.** `/create` stays dynamic: its layout reads the tz cookie and it gates on auth. `/login`
  is static, reads its query in the browser and is now `noindex`.
- **A7.** If the database is unreachable during `next build`, the sitemap falls back to the
  static pages instead of failing the build. At runtime a failure still throws, so the last
  good sitemap keeps being served.
- **A8.** No custom fonts were loaded, so nothing changed there. `twitter:image` points at
  `<path>/opengraph-image`.
- **A9.** The internal `/t/by/` and `/t/*/by/` paths are disallowed as well.
- **A11.** The item drawer also keeps polling while a render is `queued` or `rendering`, even
  when the item is `rendered`. User drawers no longer poll.
- **A12.** `/api/reel/[id]` uses `s-maxage=3600`, not 86400, so a takedown leaves every edge
  cache within the reel page's ISR hour. The Cache API cannot be purged across colos from the
  Worker.

## Part B: Cloudflare port

**B1. Dependencies.**

- In `apps/web/package.json`:
  - add `@opennextjs/cloudflare@1.20.18` (dependency) and `wrangler@^4.166.0` (devDependency);
  - remove `sharp`.
- Add `.open-next/` and `cloudflare-env.d.ts` to the root `.gitignore`. Wrangler's generated types are rebuilt by `cf-typegen`; commit them instead if typecheck needs them in CI.

**B2. Scripts.** Add to `apps/web/package.json`:

- `"build": "next build"` (unchanged)
- `"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview"`
- `"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"`
- `"upload": "opennextjs-cloudflare build && opennextjs-cloudflare upload"`
- `"cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"`

**B3. `apps/web/open-next.config.ts`.**

```ts
import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache'
import { withRegionalCache } from '@opennextjs/cloudflare/overrides/incremental-cache/regional-cache'
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue'
import d1NextTagCache from '@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache'

export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: 'long-lived' }),
  queue: doQueue,
  tagCache: d1NextTagCache,
  enableCacheInterception: true,
})
```

**B4. `apps/web/wrangler.jsonc`.**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "reelset-web",
  "main": "worker.ts",
  "compatibility_date": "2026-11-20",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "workers_dev": true,
  "preview_urls": true,
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "services": [
    { "binding": "WORKER_SELF_REFERENCE", "service": "reelset-web" },
    { "binding": "INGEST", "service": "reelset-ingest" },
    { "binding": "RENDER", "service": "reelset-render" },
  ],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "cf0f4b14f2394a58a23e8241137c45a4" }],
  "r2_buckets": [{ "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "reelset-next-cache" }],
  "d1_databases": [
    {
      "binding": "NEXT_TAG_CACHE_D1",
      "database_name": "reelset-next-tags",
      "database_id": "<from wrangler d1 create>",
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "NEXT_CACHE_DO_QUEUE", "class_name": "DOQueueHandler" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DOQueueHandler"] }],
  "limits": { "cpu_ms": 10000 },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "upload_source_maps": true,
  "vars": {
    "ADMIN_HOST": "admin.reelset.app",
    "AUTH_COOKIE_DOMAIN": ".reelset.app",
    "MEDIA_PUBLIC_BASE_URL": "https://media.reelset.app",
    "GEMINI_EMBEDDING_MODEL": "gemini-embedding-001",
    "IG_ADMIN_URL": "https://render-api.reelset.app",
    "INGEST_INTERNAL_URL": "https://ingest.reelset.app",
    "LOG_LEVEL": "info",
  },
}
```

- Routes are added in Part D only. The first deploy is reachable on workers.dev only.
- Create the resources before the first build:
  - `npx wrangler r2 bucket create reelset-next-cache`
  - `npx wrangler d1 create reelset-next-tags`, then paste the id into the config.
  - If `populateCache` does not create the table, run: `npx wrangler d1 execute reelset-next-tags --remote --command "CREATE TABLE IF NOT EXISTS revalidations (tag TEXT NOT NULL, revalidatedAt INTEGER NOT NULL, UNIQUE(tag) ON CONFLICT REPLACE)"`

**B5. Custom entry `apps/web/worker.ts`.**

```ts
// @ts-expect-error built by opennextjs-cloudflare
import handler from './.open-next/worker.js'
import { edgeCacheable, edgeCacheKey } from './src/lib/edge-cache'
export { DOQueueHandler } from './.open-next/worker.js'
export default {
  async fetch(req: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    if (!edgeCacheable.request(req)) return handler.fetch(req, env, ctx)
    const key = edgeCacheKey(req)
    const hit = await caches.default.match(key)
    if (hit) return withHeader(hit, 'x-edge-cache', 'HIT')
    const res = await handler.fetch(req, env, ctx)
    if (edgeCacheable.response(res)) ctx.waitUntil(caches.default.put(key, res.clone()))
    return withHeader(res, 'x-edge-cache', 'MISS')
  },
}
```

- `W/lib/edge-cache.ts` holds the pure logic.
  - A request qualifies when all of these hold: it is a GET; its host is not ADMIN_HOST; its path is in the allowlist (`/api/reel/`, `/api/avatar/`, `/api/showcase/`, `/llms.txt`, `/llms-full.txt`); it has no `sb-*-auth-token` cookie and no `rsc` header.
  - A response qualifies when its status is 200, it has no `set-cookie`, and its `cache-control` contains `public` and `s-maxage`.
  - The key is `https://<host><path>?<sorted query>`.
  - Range requests (showcase preview) are keyed on the range header or bypassed; bypass is the default.
- Vitest: `W/lib/edge-cache.test.ts` covers every branch.
- If OpenNext's typed export path differs, follow https://opennext.js.org/cloudflare/howtos/custom-worker.

**B6. Takedown revalidation.**

- Where admin hides or deletes an item (`W/app/admin/actions.ts` and the item drawer actions), call `revalidateTag('reel:<id>')` and `revalidatePath('/r/<slug>')`.
- Remove the pointless `revalidatePath('/profile')` from `W/app/profile/actions.ts`; the page is dynamic.
- Vitest: action logic with the scripted db asserts that the calls happen (mock `next/cache`).

**B7. Per-request DB, in `W/server/db.ts`.**

- `getDb()` does this, in order:
  1. Try `getCloudflareContext()` (sync). If `env.HYPERDRIVE` exists, memoize by `ctx` in a `WeakMap<object, DbHandle>`. Build the handle with `createDb({ connectionString: env.HYPERDRIVE.connectionString, log, max: 5 })`. No explicit close: workerd tears the sockets down when the request and its waitUntil work end, which keeps `after()` tasks safe. Hyperdrive does the pooling.
  2. Otherwise use the existing globalThis pool from `requireEnv('DATABASE_URL')` (Node: dev, Vitest, `next build`).
- Expose `resolveDbSource(ctxGetter, env)` as a pure function. Vitest covers the Hyperdrive path, the fallback path and the per-ctx memoization.
- `packages/core/src/db/client.ts`: add an optional `idleTimeoutMillis` passthrough only if needed. No other core change.

**B8. Bindings helper `W/server/cf.ts`.**

- `cfEnv()` returns `getCloudflareContext().env`, or `undefined` outside Workers, inside try/catch.
- `W/lib/instagram/worker-client.ts`, `W/server/generate/kick.ts` and `W/server/admin/gate-judge.ts`: when `cfEnv()?.RENDER` / `INGEST` exists, call `binding.fetch('https://internal' + path, init)` with the same bearer token; otherwise use the URL.
- Vitest: the client chooses the binding when it is present, and the URL otherwise (inject a fake fetcher).
- Instagram connect: the current server action waits up to 280 s. Keep it (service-binding fetch is fine), but make sure the page shows progress through the existing `rememberCheck` / `ig_account` polling if the request drops.

**B9. sharp replacement.**

- `W/server/profile-edit.ts` `saveAvatar`:
  - require `sniffImageType === 'webp'`;
  - enforce `AVATAR_MAX_BYTES`;
  - parse the dimensions with a new `W/lib/webp-size.ts` (VP8, VP8L and VP8X chunks) and require a square of at most `AVATAR_SIZE`;
  - store the bytes as they are.
- `W/lib/avatar-crop.ts` already outputs a WebP of `AVATAR_SIZE`.
- `W/app/api/profile/avatar/route.ts`: drop `runtime = 'nodejs'`, and replace `Buffer.concat` with a Uint8Array concatenation.
- Vitest: `webp-size.test.ts` with tiny fixture byte arrays for all three chunk types, plus the reject paths in `saveAvatar`.

**B10. MCP on Workers.**

- In `W/server/generate/mcp-server.ts`, construct `McpServer` with `jsonSchemaValidator: new CfWorkerJsonSchemaValidator()` from `@modelcontextprotocol/sdk/validation/cfworker`. Verify that the export exists in 1.32.2; if not, bump the SDK minor that has it.
- Remove the Vercel-only `maxDuration` exports from `api/mcp`, `admin/instagram` and `admin/(pipeline)/gate`; they are noise on Workers.

**B11. `apps/web/next.config.ts`.**

- Add `images: { unoptimized: true }` and remove `remotePatterns`.
- Add `outputFileTracingRoot: path.join(import.meta.dirname, '../..')`.
- Keep `transpilePackages` and `serverExternalPackages: ['pg', 'pino']`. Remove them only if the preview shows a resolution error.
- Keep the `env` block.
- Append `initOpenNextCloudflareForDev()`, guarded by `process.env.NODE_ENV !== 'production'`.
- Add `apps/web/public/_headers` with `/_next/static/*` set to `Cache-Control: public,max-age=31536000,immutable`.

**B12. Logger.** `W/server/logger.ts` and the core logger must use no transport in production (`pretty: false`). Verify in `preview` that pino loads; if it fails, use the browser build through a `pino` alias in next.config `turbopack.resolveAlias`.

**B13. Checks.**

- `npm run typecheck` and `npm test` at the root.
- `cd apps/web && npm run preview`, then smoke `/`, `/r/<slug>`, `/t`, `/sitemap.xml`, `/api/ask` (SSE) and `/api/mcp` locally.
- `npx wrangler deploy --dry-run --outdir /private/tmp/claude-501/reelset-web-size` and record gzip size.
- Commit per logical unit (deps+config, db, sharp, MCP, bindings, edge cache).

## Part C: preview deploy + secrets

Run everything from `apps/web`, with `unset CLOUDFLARE_API_TOKEN` first. Never print values.

1. **Build the merged secret file without echoing.**
   - A node script in the scratchpad reads `/private/tmp/claude-501/reelset-vercel.env`.
   - It replaces each `[SENSITIVE]` with the value of the same key from `/home/dev/Desktop/code/my_projects/reelset/.env.local`.
   - `INGEST_INTERNAL_TOKEN` takes the value of `SELFCHECK_TOKEN`.
   - It writes two files, both `chmod 600`:
     - `/private/tmp/claude-501/reelset-web.build.env`: the `NEXT_PUBLIC_*` keys, `AUTH_COOKIE_DOMAIN`, `MEDIA_PUBLIC_BASE_URL`, `ADMIN_HOST`, and `DATABASE_URL` for build-time prerenders. If the direct host is unreachable, the script rewrites `DATABASE_URL` to the Supabase transaction pooler (`postgres.<ref>@aws-0-<region>.pooler.supabase.com:6543`), probed with a short `pg` connect.
     - `/private/tmp/claude-501/reelset-web.secrets.json`: `CLAUDE_API_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `INGEST_INTERNAL_TOKEN`, `IG_ADMIN_TOKEN`, `ADMIN_EMAILS`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No `DATABASE_URL`; Hyperdrive replaces it.
   - The script prints only key names and present/missing.
2. **Create the resources (B4)**, then paste the D1 id into the config and commit.
3. **Build and deploy:** `set -a; . /private/tmp/claude-501/reelset-web.build.env; set +a; npm run deploy`. This runs populateCache remote and wrangler deploy, and creates `reelset-web` on workers.dev.
4. **Upload the secrets:** `npx wrangler secret bulk /private/tmp/claude-501/reelset-web.secrets.json`. This creates a new version that serves immediately.
5. **Smoke on `https://reelset-web.account-subdomain.workers.dev`:** `/`, `/r/<slug>`, `/t`, `/sitemap.xml`, `/robots.txt`, OG PNG, `POST /api/ask` streaming, `/api/mcp` 401 without a key.
   - Expected: auth flows fail here (see Risks), and the Cache API shows MISS only.
6. **Delete the temp files when Part E passes:** `rm /private/tmp/claude-501/reelset-web.build.env /private/tmp/claude-501/reelset-web.secrets.json /private/tmp/claude-501/reelset-vercel.env`. Also delete any `apps/web/.env*` that the Vercel CLI wrote.

## Part D: DNS cutover

The current records are A `reelset.app` -> `216.198.79.1` (Vercel, DNS-only) and CNAME `admin` -> `5bf357ca727ecb12.vercel-dns-017.com` (DNS-only). There is no `www`. Zone `93d415b2cc23c22f5c705fc3c008bbeb`, account `deea05d376a100365fb3e5fed18053ee`.

1. **Add the routes to `apps/web/wrangler.jsonc`:** `"routes": [{ "pattern": "reelset.app", "custom_domain": true }, { "pattern": "admin.reelset.app", "custom_domain": true }]`. Then rebuild with the build env and run `npm run deploy`.
2. **If wrangler fails with "externally managed DNS records", call the API with override.** Pass the token through a variable, never printed:
   ```
   TOKEN=$(npx wrangler auth token 2>/dev/null | tail -1)
   for h in reelset.app admin.reelset.app; do
     curl -s -X PUT https://api.cloudflare.com/client/v4/accounts/deea05d376a100365fb3e5fed18053ee/workers/domains \
       -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
       --data "{\"hostname\":\"$h\",\"service\":\"reelset-web\",\"zone_id\":\"93d415b2cc23c22f5c705fc3c008bbeb\",\"environment\":\"production\",\"override_existing_dns_record\":true}" | jq '.success,.errors'
   done
   ```
   Note on `wrangler auth token`: if wrangler 4.166 has no such command, read the OAuth token from `~/.wrangler/config/default.toml` (macOS: `~/Library/Preferences/.wrangler/config/default.toml`) into the variable with `sed`.
3. **If the API is refused, use the dashboard** (Chrome tool):
   - DNS: delete the A record for `reelset.app` and the CNAME for `admin`. Keep TXT and MX.
   - Workers > reelset-web > Settings > Domains & Routes: add both custom domains.
4. **Optional `www`:** add a proxied AAAA `www` -> `100::` and a Redirect Rule `www.reelset.app/*` -> `https://reelset.app/${1}` (301). Dashboard only. Skip if DNS write is unavailable.
5. **Zone hygiene (dashboard, optional):**
   - Rocket Loader off.
   - No HTML minify on `/api/ask`.
   - Enable Web Analytics (automatic setup for the zone) if the toggle is available.
6. **Wait for the certificates:** `curl -sI https://reelset.app` should return `server: cloudflare` and 200, then run Part E.

Rollback (about 5 minutes):

- Remove the custom domains: delete the `routes` and redeploy, or use Dashboard > Domains & Routes > remove.
- Recreate A `reelset.app` -> `216.198.79.1` and CNAME `admin` -> `5bf357ca727ecb12.vercel-dns-017.com`, both DNS-only.
- Vercel serves again only after the pause lifts (new billing cycle or upgrade). The Vercel project and its domains are kept, so no reconfiguration is needed.
- R2, D1 and the DO hold cache only and can stay.

## Part E: verification checklist

Run the curl checks against `https://reelset.app` unless noted. "Twice" means the second response is the cached one.

- [ ] `curl -sI /` returns 200 with no `set-cookie`. Twice: `x-nextjs-cache: HIT` or `STALE` on the second.
- [ ] `curl -sI /r/<real-slug>` returns 200 with no `set-cookie`. The second request is a HIT. `/r/does-not-exist` returns 404.
- [ ] `/t` and `/t/<topic>` return 200 and are cached on the second request. `?source=github` renders the same HTML, and the filter is applied on the client.
- [ ] `/sitemap.xml` returns 200 `application/xml` with more than 1 `<url>`, cached on the second request. `/robots.txt` contains the `Disallow: /*?*topic=` line. `/llms.txt` returns 200 and the second request has `x-edge-cache: HIT`.
- [ ] `/r/<slug>/opengraph-image` returns 200 `image/png`, cached on the second request. `/opengraph-image` returns 200. `twitter:image` in the HTML equals the OG URL.
- [ ] `/manifest.webmanifest` returns 200 JSON. `/_next/static/...` returns `cache-control: public,max-age=31536000,immutable`.
- [ ] `/api/reel/<id>` returns 200, and the second request has `x-edge-cache: HIT`. `/api/avatar/<id>` returns 200 `image/webp` or 404.
- [ ] `curl -N -X POST /api/ask -H 'content-type: application/json' -d '{"question":"what is bun"}'` streams `data:` events incrementally and ends with citations.
- [ ] `curl -s -X POST /api/mcp -d '{}'` returns 401. With a valid `rs_live_` key (create one in the browser at `/profile` if a session exists), `tools/list` returns the tools.
- [ ] `curl -sI https://admin.reelset.app/` redirects to login or admin, not 404. `https://admin.reelset.app/r/x` returns 404, as `routeForHost` dictates.
- [ ] Browser (Chrome tool, existing `.reelset.app` session):
  - the feed loads with the avatar and the liked state;
  - like, save and unsave persist after reload;
  - the views and events beacons return 2xx;
  - `/profile` avatar upload works and the new avatar shows;
  - logout clears `rs_auth` and the auth cookies on both hosts;
  - the login page sends a magic link (the request returns ok; the email itself is not tested);
  - `/create` generate flow kicks ingest (ingest worker tail shows `/internal/generate/kick` through the service binding);
  - admin overview, pipeline, gate, settings, health, capacity, generate and instagram (insights tab) all render;
  - AutoRefresh polls at 30 s and stops when idle.
- [ ] CPU:
  - Run `npx wrangler tail reelset-web --format json | jq '{url: .event.request.url, cpu: .cpuTime, wall: .wallTime, outcome}'` while crawling 50 URLs with `xargs -P4 curl -so /dev/null`.
  - Expected: cached hits at 1-5 ms CPU, cold ISR misses under 200 ms, no `exceededCpu`.
  - Observability (dashboard > Workers > reelset-web > Metrics): CPU time p50 under 5 ms after 1 h. Workers Paid includes 30M CPU-ms per month; target under 10% of that.
- [ ] Errors: `wrangler tail --status error` stays empty for 10 minutes of crawling. In particular, none of: `Cannot perform I/O on behalf of a different request`, `new Function`, `FinalizationRegistry`.

## Part F: docs

- `docs/infra.md`:
  - The Domains table: `reelset.app` and `admin.reelset.app` are served by the Worker `reelset-web` through Custom Domains.
  - Replace the Vercel section with "Web (Cloudflare Workers, OpenNext)", covering:
    - bindings (HYPERDRIVE, NEXT_INC_CACHE_R2_BUCKET `reelset-next-cache`, NEXT_TAG_CACHE_D1 `reelset-next-tags`, NEXT_CACHE_DO_QUEUE, INGEST, RENDER, WORKER_SELF_REFERENCE);
    - vars versus secrets;
    - build-time env (`NEXT_PUBLIC_*`, `AUTH_COOKIE_DOMAIN`, `MEDIA_PUBLIC_BASE_URL`, `DATABASE_URL` for prerender);
    - deploy (`set -a; . <build env>; set +a; npm run deploy -w @reelset/web`);
    - `cpu_ms` 10000;
    - the edge-cache allowlist;
    - rollback.
  - Add `reelset-web` to the Workers list.
  - Move Vercel to "Legacy (paused, kept for rollback)".
  - Remove the stale "Still to do" Vercel line.
- `docs/contracts.md` web env list:
  - add `AUTH_COOKIE_DOMAIN`, `INGEST_INTERNAL_*`, `IG_ADMIN_*`, `RESEND_API_KEY`, `LOG_LEVEL`;
  - mark `DATABASE_URL` as dev/build only (runtime uses HYPERDRIVE);
  - note that `GEMINI_MODEL` is unused.
- README deploy notes: web deploy command, preview (`npm run preview -w @reelset/web`), and the rule that plain `wrangler deploy` must not be used because it skips populateCache.
- `CLAUDE.md` layout line: `apps/web` is a Next.js PWA on Cloudflare Workers (OpenNext).

## Follow-ups (not in this migration)

- Pre-render OG PNGs into R2 in the render pipeline and point metadata at media.reelset.app, which removes the OG route.
- Merge the views and events beacons into one endpoint that enqueues to a Cloudflare Queue consumed by reelset-ingest for batched inserts.
- Add Workers Builds CI with build variables.
