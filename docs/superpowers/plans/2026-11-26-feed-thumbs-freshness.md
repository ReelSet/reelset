# Feed fixes, small thumbnails and fresher posting: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five problems the owner found on reelset.app:

1. The first reel jumps from A to B for signed-in viewers.
2. The desktop details panel can't be scrolled.
3. Tapping keeps toggling mute instead of play/pause.
4. Thumbnails are slow (full-size 300 KB JPEGs with no caching).
5. High-scoring stories wait days, and duplicates go out.

**Architecture:** Four tasks that don't touch each other's files, so they run in parallel:

- **Task 1:** feed UI in `apps/web/src/components/feed`.
- **Task 2:** thumbnails, end to end (render container, render worker, migration, web queries and grids, backfill script).
- **Task 3:** Instagram queue order, stale-post expiry, duplicate skip and an honest wait time.
- **Task 4:** ingest admission (skip duplicate stories, let high gate scores skip pacing).

Task 0 is already done: `sameStory(a, b)` / `storyWords(title)` in `packages/core/src/domain/story-match.ts`, exported from `@reelset/core`.

**Tech Stack:** TypeScript strict monorepo:

- Next.js on Cloudflare Workers (OpenNext)
- Cloudflare Workers + Queues
- Kysely + Prisma on Supabase Postgres
- Python 3 + ffmpeg render container
- Vitest and Python unittest

**Spec:** the owner's five reports and the agreed fixes, summarized under each task below.

## Global Constraints

- Read `CLAUDE.md` at the repo root first. Its rules apply to every task:
  - no semicolons, single quotes, width 100
  - no frontend tests (no React component tests)
  - status changes only through `transitionItem`
  - schema changes only in `schema.prisma` plus a new migration
  - never print, log or commit connection strings or keys
- Do NOT commit, push or deploy. The lead reviews, commits and deploys.
- Never add Co-Authored-By or "Generated with Claude" lines anywhere.
- Never print URLs of the media host, Modal or any account. Filter shell output with `grep -vE "https?://"` when it could contain one.
- Log at edges and decision points with the existing pino child loggers, carrying ids (itemId, postId, renderKey).
- Each task updates the matching section of `docs/contracts.md`. Read the file again right before editing, because other tasks edit other sections in parallel.
- Other agents are editing other files in the same working tree at the same time. Touch only the files your task lists, plus `docs/contracts.md` and `packages/core/src/index.ts` exports. If a test fails in a file you did not touch, report it; don't fix it.
- Finish with these, run from the repo root, and report the results:
  - `npm run typecheck`
  - the test commands your task names

## Review Focus

1. **Box images:** an old render box image has no `thumb` asset. The render must still succeed, with `thumb_key` left null and grids falling back to the poster (Task 2 test).
2. **Personal feed refresh:** the personal feed arrives while the viewer is still on reel A. A stays at index 0, and the personal list follows with A removed (Task 1 test on `pinCurrentFirst`).
3. **Instagram queue starvation:** low-score auto posts must not wait forever. Queued auto posts older than 36 h are expired and the reason is recorded (Task 3 test).
4. **Duplicates within one run:** two duplicates arriving in the same admission run admit only the first (Task 4 test).
5. **Wait time outside posting hours:** a post queued at 15:20 ET gets a wait time at or after 18:00 ET, not "in 12 min" (Task 3 test).

---

### Task 1: Feed UI. Keep reel A on screen, one scroll area in the details panel, tap to pause once sound is on

**Files:**

- Create: `apps/web/src/lib/feed-merge.ts`, `apps/web/src/lib/feed-merge.test.ts`
- Modify:
  - `apps/web/src/components/feed/FeedClient.tsx` (`refreshInPlace`, around line 304; details column, around lines 598-610)
  - `apps/web/src/components/feed/ReelPanel.tsx`
  - `apps/web/src/components/feed/ReelCard.tsx` (`onTap`, around line 208; the overlay button's `aria-label`, around line 313)

**Interfaces:**

- Produces: `pinCurrentFirst<T extends { id: string }>(current: T | undefined, incoming: T[]): T[]`
  - Returns `incoming` unchanged when `current` is undefined.
  - Otherwise returns `[current, ...incoming without current.id]`.

- [ ] **Step 1: Write the failing test** in `feed-merge.test.ts`:
  - `pinCurrentFirst({id:'a'}, [{id:'b'},{id:'a'},{id:'c'}])` equals `[a, b, c]`
  - `pinCurrentFirst(undefined, [b])` equals `[b]`
  - `pinCurrentFirst({id:'a'}, [])` equals `[a]`
- [ ] **Step 2:** Run `npx vitest run src/lib/feed-merge.test.ts` in `apps/web`. Expect it to FAIL.
- [ ] **Step 3:** Implement `pinCurrentFirst`.
- [ ] **Step 4: Reel A stays (report #1).** In `refreshInPlace`, for the personal (not scoped) case while `activeRef.current === 0`:
  - Pass the feed through with `items: pinCurrentFirst(itemsRef.current[0], feed.items)` before `applyFeed`.
  - Don't scroll to top, because the viewer is already there.
  - A scoped feed (`?topic=` / `?source=`) still replaces the list as it does today.
- [ ] **Step 5: One scroll area in the details panel (report #2).** Today the panel nests two scroll boxes:
  - The outer `#reel-details-panel` region has `overflow-y-auto` and a hidden scrollbar.
  - The inner tab body in `ReelPanel` has a fixed `h-[clamp(12rem,36dvh,22rem)]` and `overscroll-contain`.
  - So a wheel over the tab body does nothing when its text fits but the column is clipped.

  Make it a single scroller that always fits the column:
  - The region becomes `flex min-h-0 flex-1 flex-col` with no overflow of its own (keep the fade mask).
  - `ReelPanel`'s `<article>` becomes `flex min-h-0 flex-1 flex-col`.
  - The tab body becomes `min-h-0 flex-1 overflow-y-auto`, with a thin visible scrollbar (`[scrollbar-width:thin]`) and no `overscroll-contain`.
  - Header, tabs and `TopicsNav` stay fixed.
  - `CreatePromo`, the nav buttons and the shortcut list keep `shrink-0`.
  - Check that the `/r/` page's `about` panel still renders. It passes its own node through the same region.

- [ ] **Step 6: Tap to pause once sound is on (report #3).** In `ReelCard.onTap`, when sound is already on (`soundRef.current`):
  - Replace `setTimeout(() => setSound(false), DOUBLE_TAP_MS)` with `setTimeout(() => togglePause(), DOUBLE_TAP_MS)`, so a double tap still likes and does not pause.
  - When sound is off, a tap still turns it on right away (browsers only allow unmuting inside the tap).
  - Muting stays on the rail's speaker button and the `m` key.
  - Change the overlay `aria-label` to `Tap for sound, then tap to pause or play, double tap to like`.
- [ ] **Step 7:** Run `npx vitest run` in `apps/web` and `npm run typecheck` at the root. Expect both to pass.

### Task 2: Small cached thumbnails for every grid

The owner reported that thumbnails are slow. Measured on `/t`: 71 full 1080×1920 JPEGs, about 300 KB each, 21 MB in total, 18 loaded eagerly, no `Cache-Control` header, `cf-cache-status: DYNAMIC`. The fix: a 360 px-wide WebP thumbnail (target 15–40 KB) per render, stored in R2 next to the poster, used by every grid, cached by browsers.

**Files:**

- Container:
  - Modify `workers/render/container/reel/video.py`: add `build_thumb_cmd(poster: str, out: str) -> list`, which returns `ffmpeg -y -hide_banner -loglevel error -i <poster> -vf scale=360:-2 -c:v libwebp -quality 75 <out>`.
  - Modify `workers/render/container/app.py`: in `ASSETS`, add `"thumb": ("thumb.webp", "image/webp")`, and allow `thumb` in `ASSET_RE`.
  - Modify the render pipeline step that writes `poster.jpg` (find it from `poster.py` / `build_poster_cmd` callers) so it also writes `thumb.webp` next to it. A thumb failure logs a warning and does not fail the render.
  - Tests: `workers/render/container/tests/` (follow the existing style).
- Schema:
  - Add `thumbKey String? @map("thumb_key")` to `model Render` in `packages/core/prisma/schema.prisma`.
  - Add a new migration under `packages/core/prisma/migrations/` (`ALTER TABLE "render" ADD COLUMN "thumb_key" TEXT;`).
  - Run `npm run db:generate` so the Kysely types update. Do NOT run `db:deploy`; the lead applies it.
- Keys and URLs:
  - In `workers/render/src/keys.ts`, add `thumbKeyFor(itemId, renderKey)`, which returns `reels/<itemId>/<renderKey>.thumb.webp`.
  - In `packages/core/src/domain/media-url.ts`, thumb keys get the same `?v=` cache-version suffix as posters. Extend the key pattern and add a test.
- Render worker:
  - Modify `workers/render/src/consumer.ts` (upload, around line 420).
  - Also modify the helper that saves `poster_key` on the render row.
  - Test in `workers/render/src/consumer.test.ts`.
- Web:
  - Every query that returns `posterUrl` for a grid or list also returns `thumbUrl: string | null`: `seo-queries.ts`, `profile.ts`, `lib/ask/related-reels.ts`, `lib/showcase.ts` and their DTO types.
  - Grid components render `thumbUrl ?? posterUrl`: `components/seo/Browse.tsx`, `components/profile/ProfileLibrary.tsx`, `components/ask/AnswerSources.tsx`, `components/ask/SourcesSheet.tsx`.
  - The full-screen feed `ReelCard` keeps the poster (Task 1 owns that file).
- Backfill: create `scripts/backfill-thumbs.mts`.

**Interfaces:**

- Produces:
  - `render.thumb_key` (nullable)
  - `thumbKeyFor(itemId: string, renderKey: string): string`
  - a `thumbUrl` field next to `posterUrl` in grid DTOs

- [ ] **Step 1: Failing tests.**
  - Container unit test: `build_thumb_cmd('p.jpg','t.webp')` contains `scale=360:-2` and `libwebp`.
  - `consumer.test.ts`, three cases:
    - When the box serves a `thumb` asset, the worker uploads it to `thumbKeyFor(...)` with `httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=604800' }` and saves `thumb_key`.
    - When the `thumb` download fails (old box image), the render still finishes, `thumb_key` is null, and a warning is logged.
    - Poster and video uploads now carry `cacheControl: 'public, max-age=604800'`.
  - `media-url` test: a `.thumb.webp` reel key gets the `?v=` suffix.
- [ ] **Step 2:** Run the tests and expect them to fail:
  - `python3 -m unittest discover -s workers/render/container/tests`
  - `npx vitest run` in `workers/render` and `packages/core`
- [ ] **Step 3:** Implement the container, schema, keys, upload and saving in the order listed under Files.
- [ ] **Step 4: Web.**
  - Add `thumbUrl` to the queries and grids.
  - In `Browse.tsx`, load only the first 6 cards eagerly, the rest `loading="lazy"`.
  - Add `decoding="async"` and `width={360} height={640}` to grid images.
- [ ] **Step 5: Backfill script.** `node --env-file=.env.local --import tsx scripts/backfill-thumbs.mts [--dry-run] [--limit N]`:
  - Select renders with `poster_key is not null and thumb_key is null`.
  - For each one:
    - Download the poster from `MEDIA_PUBLIC_BASE_URL` + key (never print the URL).
    - Convert it with local `ffmpeg` (`/opt/homebrew/bin/ffmpeg`, same arguments as `build_thumb_cmd`) into a temporary folder.
    - Upload with `env -u CLOUDFLARE_API_TOKEN npx wrangler r2 object put reelset-media/<thumbKey> --file <f> --content-type image/webp --cache-control "public, max-age=604800" --remote`, run from `workers/render`.
    - Then set `thumb_key`.
  - Run 4 at a time.
  - Idempotent: rerunning skips rows that already have `thumb_key`.
  - Logs one line per render (renderKey, bytes) and a final summary.
  - Test it only with `--dry-run --limit 3`. The lead runs it for real after deploying.
- [ ] **Step 6:** Run all suites and expect them to pass:
  - container unittest
  - `npx vitest run` in `workers/render`, `packages/core` and `apps/web`
  - `npm run typecheck`
  - `npm run db:check`

### Task 3: Instagram queue. Judge's best first, expire stale posts, skip duplicates, honest wait time

The Nvidia reel (gate score 88) waited 17+ h in a first-in-first-out queue that only posts at 11-14 and 18-22 ET, 25 min apart. A reel of the same story had already posted the day before. The admin page said "about 12 min (posts are spaced 10 min apart)".

**Files:**

- Modify `packages/core/src/repos/instagram-post.repo.ts`:
  - `claimNextPost` ordering.
  - New `expireStaleAutoPosts`.
  - The admin `postQueue` listing order, wherever it lives. Find it from `apps/web/src/app/admin/instagram/page.tsx`.
- Modify `packages/core/src/domain/instagram-post.ts`: `queuedPostEtas`.
- Modify `workers/render/src/instagram/auto.ts` (duplicate skip at queue time) and its deps wiring in `workers/render/src/instagram/store.ts` / `wire.ts`.
- Modify the render cron that claims posts: call `expireStaleAutoPosts` before claiming.
- Modify `apps/web/src/app/admin/instagram/page.tsx` and `apps/web/src/components/admin/instagram/QueueList.tsx` (wait time and label).
- Tests: the matching `*.test.ts` files next to each file.

**Interfaces:**

- Consumes: `sameStory(a: string, b: string): boolean` from `@reelset/core`.
- Produces:
  - `expireStaleAutoPosts(db: Database, log: Logger, maxHours = INSTAGRAM_AUTO_MAX_QUEUED_HOURS): Promise<number>`
  - `INSTAGRAM_AUTO_MAX_QUEUED_HOURS = 36`
  - `queuedPostEtas(queued: readonly { auto: boolean }[], lastPostedAt: Date | null, now: Date): Date[]`

- [ ] **Step 1: Failing tests.**
  - `queuedPostEtas`:
    - With `now` = 2026-11-25T20:20Z (15:20 ET) and one auto post, the wait time is ≥ 2026-11-25T23:00Z (18:00 ET).
    - Two auto posts inside the window are ≥ 25 min apart.
    - A manual post inside the gap is due at the next cron tick ≥ 10 min after `lastPostedAt`, at any hour.
  - `auto.ts`:
    - A candidate whose title `sameStory`-matches an item with an Instagram post (status queued, posting or posted) created in the last 72 h is not inserted.
    - It logs `'duplicate story, not queued'` with both itemIds.
  - Repo SQL tests (follow the fake-DB / SQL-string style the repo tests already use):
    - `claimNextPost` orders manual first, then by the item's latest `gate_decision.score` (fall back to `item.score * 100`) descending, then `created_at`.
    - `expireStaleAutoPosts` sets auto posts queued > 36 h to `failed` with error `Skipped: waited over 36 hours to post, the story is stale.` and returns the count.
- [ ] **Step 2:** Run the tests and expect them to fail.
- [ ] **Step 3:** Implement.
  - `queuedPostEtas` walks the queue in claim order (manual first). For each post it finds the earliest cron tick (`INSTAGRAM_CRON_MINUTES`) that meets all of these:
    - it is ≥ the gap since the previous post (10 min manual, 25 min auto)
    - for auto posts, its New York hour is in `INSTAGRAM_AUTO_POST_HOURS` (use `Intl.DateTimeFormat` with `timeZone: 'America/New_York'`)
  - The page passes `{ auto: requested_by === 'auto' }` per queued row, in the new claim order.
- [ ] **Step 4:** Label text: `{etaLabel} (auto posts go out 11am to 3pm and 6 to 11pm ET, 25 min apart)` for auto rows, and `{etaLabel} (posts are spaced 10 min apart)` for manual rows.
- [ ] **Step 5:** Run `npx vitest run` in `packages/core`, `workers/render` and `apps/web`, plus `npm run typecheck`. Expect everything to pass.

### Task 4: Admission. Skip duplicate stories, fast-track high gate scores

Report #5: a story found Nov 23 15:02 UTC with gate score 88 waited 33 h for admission, and it repeated a story admitted the day before. Pacing (`c8c09ec`) already spreads slots across the day. Two things are still missing:

- skipping duplicate stories
- a fast lane so the judge's best stories never wait for the next paced slot

**Files:**

- Modify `workers/ingest/src/reconcile/policy.ts`:
  - `AdmissionInput` gets `fastTrack: boolean`.
  - `AdmissionSkip` gets `'duplicate'`.
- Modify `workers/ingest/src/reconcile/reconcile.ts`: the admission loop, a new recent-titles query, and the `skipped` counts.
- Modify `workers/ingest/src/config.ts`: add `PACE_BYPASS_GATE_SCORE = 85` and `DUPLICATE_WINDOW_MS = 72 * HOUR_MS`.
- Test: `workers/ingest/test/reconcile.test.ts`.
- If the web admin lists skip reasons, also update `apps/web/src/server/admin/pipeline-queries.ts`. Grep for `'pace'`.

**Interfaces:**

- Consumes: `sameStory` from `@reelset/core`.
- Produces: skip reason `'duplicate'`, and the `fastTrack` flag on `AdmissionInput`.

- [ ] **Step 1: Failing tests** in `reconcile.test.ts` (extend the fake DB the file already has):
  - A candidate whose title `sameStory`-matches an item admitted (`queued_at` within 72 h, status not in `CAP_EXEMPT_STATUSES`) is skipped as `duplicate` and not admitted.
  - Two same-story candidates in one run: only the higher-ranked one is admitted, and the other is skipped as `duplicate`.
  - A candidate with latest gate score ≥ 85 is admitted even when `admittedToday >= pacedCap`, but still not when the daily cap or spend cap is reached.
  - Policy unit test: `fastTrack: true` never returns `'pace'`, but still returns `'daily_cap'` and `'spend_cap'`.
- [ ] **Step 2:** Run `npx vitest run test/reconcile.test.ts` in `workers/ingest`. Expect it to FAIL.
- [ ] **Step 3:** Implement.
  - Load recent admitted titles once per run, then add each admitted title as the loop goes.
  - Check duplicates before the cap checks, so a duplicate never uses a slot.
  - Read each candidate's latest gate score in the same way the gate-override lookup reads `gate_decision`.
  - Admin overrides and requested reels keep their existing bypasses. Requested reels skip the duplicate check too, because a user asked for them.
  - Log each duplicate skip with both itemIds and titles.
- [ ] **Step 4:** Run `npx vitest run` in `workers/ingest` and `npm run typecheck`. Expect both to pass.

---

## Lead steps after the tasks (not for subagents)

1. Review each task's diff.
2. Run the full `npm test` and `npm run typecheck`.
3. Commit per task.
4. `npm run db:deploy` (thumb_key migration).
5. Deploy:
   - ingest worker
   - render worker
   - push to main (web deploy, CI, render image build)
6. Run `scripts/backfill-thumbs.mts`.
7. Raise `pipeline_daily_spend_cap_usd` from 2 to 3.75 (about 25 reels a day at $0.148 each).
8. Remove the already-queued duplicate Nvidia Instagram post (`aed92e62…`).
9. Check the live site in a browser.
10. Edge caching on the media domain needs a Cloudflare Cache Rule. The API token in `.env.local` can't edit zone rules, so the owner adds it in the dashboard.
