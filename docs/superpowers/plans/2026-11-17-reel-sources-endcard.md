# Sources on the Reel End Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every reel ends on a card that lists its top sources and says "Sources in the caption".
The Instagram caption never loses its `Source:` line.

**Architecture:**

- The render worker picks up to 3 source labels from the item's mentions and sends them as
  `sources` in the render payload.
- The Python container validates them and passes them into the Skia props.
- The Skia EndCard draws them.
- The director path appends the planner's EndCard after the model's scenes.
- The end-card timing gets a 2.5 s minimum.

**Tech Stack:** TypeScript (Cloudflare worker, Vitest), Python 3 (container, unittest), Skia
canvas renderer (TypeScript, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-17-reel-sources-endcard-design.md`

## Global Constraints

- At most 3 sources. Each is a short label (host, or `github.com/owner/repo`) of at most 48 chars,
  never a full URL.
- The card copy is exactly `Sources` (label) and `Sources in the caption` (line).
- The end card is on screen for at least 2.5 s and at most 3 s (`END_CARD_MAX_S` stays 3). No
  silence is added.
- No new Instagram permissions. The caption keeps `Source: <canonicalUrl>`.
- Style: TS strict, no semicolons, single quotes, width 100. Python is formatted like the
  surrounding code. No frontend tests.
- No deploy until the user has watched the local renders.

## Review Focus

- **A reel with a single mention, or all mentions on the same host.** Expect the card to show 1
  source, with no duplicates and no empty "Sources" label. Covered in Task 1.
- **An HN or Reddit item whose canonical URL is the thread itself.** Expect the thread host once,
  not twice. Covered in Task 1 by the dedupe-by-host test.
- **Old payloads with no `sources` field (preview scripts, retries).** Expect validation to accept
  them and the card to look as it does today. Covered in Tasks 2 and 3.
- **A director reel whose last scene is shorter than the card.** Expect the scene to be dropped,
  not left with a zero or negative length. Covered in Task 4.
- **A long name plus 3 sources on the card.** Expect no overflow past the Follow pill. Checked by
  eye in Task 6. The fit logic is in Task 3.

---

### Task 1: Pick the sources in the render worker

**Files:**

- Create: `workers/render/src/end-sources.ts`, `workers/render/src/end-sources.test.ts`
- Modify:
  - `workers/render/src/store.ts`: add `sources: string[]` to `ItemForRender`, filled from the
    mentions already loaded.
  - `workers/render/src/container-client.ts`: add `sources?: string[]` to `RenderInput`.
  - `workers/render/src/consumer.ts` `renderAndUpload`: pass `sources: item.sources`.
  - `scripts/maintenance/preview-render.ts`: same field on its `RenderInput`.

**Interfaces:**

- Produces:
  `endSources(input: { source: Source | null; canonicalUrl: string; mentions: { url: string | null; score: number | null }[] }): string[]`
  - The canonical URL's label comes first, then the mention hosts in the order given (already
    score-desc), deduped by host, at most 3.
  - Label rule: host without `www.`. For a github.com URL the label is host + path without the
    trailing `/`. Truncate to 47 chars + `…` when over 48.
  - Bad URLs are skipped.

- [ ] **Step 1: Write failing tests** in `end-sources.test.ts`:
  - `canonical first, then other hosts by order, max 3`: canonical `https://www.theverge.com/a`,
    mentions on news.ycombinator.com, reddit.com, theverge.com/b and arstechnica.com give
    `['theverge.com','news.ycombinator.com','reddit.com']`.
  - `github canonical shows owner/repo`: `https://github.com/acme/tool/` gives
    `['github.com/acme/tool']`.
  - `dedupes by host and skips bad urls`: mentions `[null, 'not a url', canonical host again]`
    give only the canonical label.
  - `truncates long labels to 48 chars`.
- [ ] **Step 2: Run the tests and see them fail.** Run
      `cd workers/render && npx vitest run src/end-sources.test.ts`.
- [ ] **Step 3: Implement `endSources`**, then wire it into store, client, consumer and preview.
- [ ] **Step 4: Run the tests and typecheck.** Run
      `npx vitest run src/end-sources.test.ts && npm run typecheck` (repo root). Expect PASS. Fix any
      store or consumer test that builds an `ItemForRender` literal by adding `sources: []`.
- [ ] **Step 5: Commit**: "Render worker sends the reel's top 3 source labels".

### Task 2: Pass sources through the container

**Files:**

- Modify:
  - `workers/render/container/reel/validation.py`: add `sources: list` (default `[]`) to
    `RenderRequest`, read from `payload.get("sources")`.
  - `workers/render/container/reel/props.py` `build_props`: set `props["sources"]` when non-empty.
- Test: `workers/render/container/tests/test_logic.py` (next to the other validation tests).

**Interfaces:**

- Consumes: the `sources` payload field from Task 1.
- Produces: `ReelProps.sources?: string[]` (Task 3 adds the TS type).
- Validation rule: missing or `None` gives `[]`. Otherwise it must be a list of at most 3
  non-empty strings, each at most 48 chars, else `_bad("sources must be up to 3 short labels")`.

- [ ] **Step 1: Write failing tests**:
  - `test_sources_default_to_empty`
  - `test_sources_pass_into_props`: `build_props` output has `sources == ['a.com','b.com']`.
  - `test_sources_reject_bad_values`: 4 items, a non-string, or a 60-char label each raise.
- [ ] **Step 2: Run the tests and see them fail.** Run
      `cd workers/render/container && python -m pytest tests/test_logic.py -k sources -q`, or
      `python -m unittest` if pytest is missing.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run the tests again.** Expect PASS. The 30 tests that already fail locally (missing
      pymupdf or youtube_transcript_api) are unrelated.
- [ ] **Step 5: Commit**: "Container validates and passes reel sources to the renderer".

### Task 3: Draw sources on the EndCard

**Files:**

- Modify:
  - `workers/render/container/skia/src/planner/lib/types.ts`: `ReelProps.sources?: string[]`.
  - The `ReelCtx` builder: expose `sources` on ctx the same way `domain` is exposed. Find it with
    `grep -n "domain:" src/**/*.ts`.
  - `workers/render/container/skia/src/screens/core.ts` `EndCard`.
- Test: `workers/render/container/skia/src/planner/lib/endcard.test.ts` (create it if missing).

**Interfaces:**

- Produces: `endSourceLines(ctx: EndCtx): string[]` in `planner/lib/endcard.ts`.
  - It returns `ctx.sources` when non-empty.
  - Otherwise it returns `[endSource(ctx)]`, so cards rendered from old payloads still show one
    source.
  - Empty strings are dropped.

- [ ] **Step 1: Write failing tests**:
  - `uses props sources when present`
  - `falls back to the single endSource`: no sources and a github repo give
    `['github.com/o/r']`.
- [ ] **Step 2: Run the tests and see them fail.** Run
      `cd workers/render/container/skia && npx vitest run src/planner/lib/endcard.test.ts`.
- [ ] **Step 3: Implement `endSourceLines`, then the EndCard layout.**
  - The order is: chip, name, subtitle, then the `Sources` label (bold, 30 px, muted).
  - Then one line per source (bold, 36 px, white at 0.85), rising in with the existing
    `riseLines` at t 0.5.
  - Then `Sources in the caption` (bold, 30 px, `rgba(246,244,238,0.6)`), then the existing Follow
    pill, delayed to about t 0.9.
  - Add the new rows to `blockH`. If `blockH` is taller than `z.h`, lower the name's `fitBlock`
    `max` until it fits.
- [ ] **Step 4: Run the tests and the build.** Run `npx vitest run && npm run build`. Expect PASS
      and the build succeeds.
- [ ] **Step 5: Commit**: "End card lists the reel's sources and points to the caption".

### Task 4: Director reels end on the EndCard, with a 2.5 s minimum

**Files:**

- Modify:
  - `workers/render/container/skia/src/planner/lib/plates.ts`: add `END_CARD_MIN_S = 2.5` and
    extend `capEndCard`.
  - `workers/render/container/skia/src/director/scene-reel.ts` `applyScenes`.
- Test: `src/planner/lib/plates.test.ts` (create it if missing), `src/director/scene-reel.test.ts`.

**Interfaces:**

- `capEndCard(shots, fps, maxHold = 4)` now also grows a too-short card. When
  `last.frames < round(END_CARD_MIN_S * fps)`, it moves frames from `prev` to the card, leaving
  `prev` at least `round(1 * fps)` frames.
- `applyScenes(base, scenes, onError)` appends the planner's last shot when it is an EndCard
  (`base.shots.at(-1)?.show === 'EndCard'`).
  - The card starts at `cardT0 = duration - clamp(base card dur, END_CARD_MIN_S, END_CARD_MAX_S)`.
  - Model scenes are clipped to `t1 <= cardT0`. Scenes left shorter than 0.5 s are dropped.
  - The card's `index` and `sceneIndex` follow the model scenes. Its `enter` is `'up'`.
  - With no EndCard in base, behaviour is unchanged.

- [ ] **Step 1: Write failing tests**:
  - `capEndCard grows a 1.5 s card to 2.5 s from the previous shot` (fps 24: card 36 → 60 frames,
    prev loses 24).
  - `capEndCard leaves prev at least 1 s`.
  - `applyScenes ends with the base EndCard`: the last shot has `show === 'EndCard'`,
    `t1 === duration` and `t1 - t0` between 2.5 and 3.
  - `applyScenes drops a model scene that falls inside the card`.
  - `applyScenes without a base EndCard is unchanged`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement it.** Check that the director frame or timeline code maps shots by
      `t0`/`t1`, not by scene count. Read `director/config.ts` and the renderer's shot lookup.
- [ ] **Step 4: Run `npx vitest run && npm run build`.** Expect PASS.
- [ ] **Step 5: Commit**: "Director reels end on the end card; end card holds at least 2.5 s".

### Task 5: The caption keeps its Source line

**Files:**

- Modify: `packages/core/src/domain/instagram-caption.ts` `buildCaption`.
- Test: `packages/core/src/domain/instagram-caption.test.ts`.

**Interfaces:** `buildCaption(input: CaptionInput): string`, same signature as today.

- Over the limit, try these in order until one fits:
  1. lead + source + hashtags (credits dropped)
  2. lead + source + brand hashtags only
  3. lead + source, with the lead cut so the whole caption fits

- [ ] **Step 1: Write the failing test** `keeps Source when the caption is too long`: a 2,150-char
      hook still gives a caption that contains `Source: https://x.com/a` and is at most
      `INSTAGRAM_CAPTION_MAX_CHARS` long.
- [ ] **Step 2: Run the test and see it fail.** Run
      `cd packages/core && npx vitest run src/domain/instagram-caption.test.ts`.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` from the repo root.** Expect PASS. The ingest quota test may time out
      once; rerun it alone.
- [ ] **Step 5: Commit**: "Instagram caption never drops its Source line".

### Task 6: Local director render on the Mac (no deploy)

**Files:** none committed. Outputs go in the session scratchpad.

- [ ] **Step 1: Pick 2 items.** Query the database for recent done items: one GitHub item, and one
      news or HN item with mentions on 3 or more hosts.
- [ ] **Step 2: Build the payload.** Run
      `set -a; source .env.local; set +a; npx tsx scripts/maintenance/preview-render.ts <id> <script.json> <out> --payload-only`.
      The script comes from the item's current `script`, written to a file. Check that the payload has
      `sources` and a `director` block.
- [ ] **Step 3: Build the renderer.** Run `cd workers/render/container/skia && npm run build`.
- [ ] **Step 4: Render locally** with `CLAUDE_API_KEY` set from `.env.local`:
      `cd workers/render/container && python3 tools/render_local.py <payload> <out>`. It uses the Mac
      CPU and RAM, not Docker and not the boxes. If Kokoro model files are missing locally, set
      `ttsEngine` to `edge` in the payload and say so.
- [ ] **Step 5: Check the result.** Pull the last 3.5 s as frames
      (`ffmpeg -sseof -3.5 -i video.mp4 -vf fps=2 f%02d.png`). Check that the card shows the sources,
      the line and the pill, with no overflow, and that it lasts between 2.5 and 3 s. Repeat for the
      second item.
- [ ] **Step 6: Show the user** the MP4 paths and the frames. Deploy only after they approve.
