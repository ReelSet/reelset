# Reelset design system

Dark, minimal, content-first. The reel is the hero; chrome is glass, quiet, and gets out of the way.
One accent color, used sparingly for primary actions and progress.

## References (Mobbin)

- Short-video feeds (TikTok, Instagram Reels, YouTube Shorts): right-hand action rail with icon over count, caption bottom-left with a "more" affordance, thin progress bar, minimal top chrome.
- Perplexity: answer first, numbered source cards, a pill composer pinned at the bottom for follow-ups, suggested questions as rows or chips.
- Linear: dense 13px tables, grouped status dots, quiet hairline borders, filter chips, left sidebar navigation.

## Tokens (defined in `src/app/globals.css` `@theme`)

| Group   | Tokens                                                                                 |
| ------- | -------------------------------------------------------------------------------------- |
| Surface | `bg #09090b`, `surface #111114`, `raised #19191e`, `hover #202026`                     |
| Line    | `line` 8% white, `line-strong` 16% white                                               |
| Text    | `fg #f4f4f5`, `muted #a1a1aa`, `faint #71717a`                                         |
| Accent  | `accent #c8f751` with `accent-fg #0b0d04`                                              |
| Status  | `ok #5fdc9a`, `warn #f5b84b`, `danger #ff6b6b`, `info #6cb6ff`                         |
| Source  | `src-hn`, `src-reddit`, `src-youtube`, `src-github`, `src-news` (dots next to names)   |
| Radius  | `sm 8`, `md 12`, `lg 20`, pills `full`; sheets 28                                      |
| Motion  | `fast 120ms`, `base 220ms`, `slow 420ms`; `ease-out` expo-out, `ease-spring` overshoot |

## Type

Geist Sans and Geist Mono via `next/font` (swap, no layout shift). Scale: 11 (labels, chips), 13 (admin, reel meta), 14 to 16 (body, reel caption), 15 (reel title), 28 to 44 (page headings). Headings use `tracking-tight` and `text-wrap: balance`.

## Layout

- Feed: full-height snap scroller. Phones: edge to edge, `object-fit: cover`, safe-area insets. Desktop (lg): centered 9:16 column sized from viewport height, rounded and hairline bordered, brand and nav on the left, prev/next and keyboard legend on the right.
- Ask and Profile: single 42rem column. Admin: 14rem sidebar plus content up to 72rem.

## Reel safe zones

The render lane burns karaoke captions into the frame, so the app overlay must stay out of that band. Fractions are of the visible video area (the full 9:16 frame on desktop; phones use `object-fit: cover`, which crops only the sides because phones are taller than 9:16).

| Zone                 | Where                                                                                                                                                                                             | Owner        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Burned top chrome    | progress bar, source chip and watermark start at 12% of frame height or lower (`TOP_SAFE` = 156 of 1280); the mobile app header (safe-area inset plus 36px buttons) must stay within the top ~11% | render + web |
| Burned captions      | 58% to 72% of frame height from the top, centered, 72% wide (14% margins, clears the rail), 2 lines max                                                                                           | render       |
| Scene content        | below the top chrome (about 18.5%) and above 58% minus a 16px gap, and clear of the bottom 18% and right 14%                                                                                      | render       |
| App caption          | bottom 18% (collapsed), full width minus the rail (`pr-[16%]`)                                                                                                                                    | web          |
| App rail             | right 14% (`w-[14%]`, never wider at any viewport width), anchored to the bottom; Instagram-style bare icons with a soft drop shadow, no glass circles (see Reel rail)                            | web          |
| "Tap for sound" pill | just above the caption zone, at `bottom: 18% + 0.5rem`, left aligned; hidden when expanded                                                                                                        | web          |

Bottom 18% starts at 82% of frame height; the burned band ends at 72%, leaving a 10% gap, and the pill sits between at roughly 19 to 23% from the bottom (28% is the band's lower edge from the bottom).

Short viewports (`short:` variant, `max-height: 760px`, covers 685px tall phones and small laptops): the caption keeps its 2 title lines, the rail tightens its gaps, and padding shrinks. Expanding the caption may grow beyond 18% on purpose (it is user initiated and hides the pill). While expanded, a dark scrim (about 50 to 80% black gradient, `z-[15]`, between the tap layer and the caption) covers the video so the burned caption is suppressed; the video keeps playing. The expanded panel is capped at 45% of the video height (`45cqh`, the section is a size container) and scrolls inside. Tapping the scrim, the TLDR or "less" collapses it. The scrim fades in 300ms on opacity only; reduced motion removes the transition.

## Reel rail

Modelled on Instagram Reels (Mobbin): no circles or glass, white glyphs with a `drop-shadow(0 1px 3px rgb(0 0 0 / .55))` for legibility. Like 30px, other icons 26 to 28px; counts 12px semibold under Like and Sources only; every button is at least 44px tall and wide (`min-h-11`), visual gap about 20px (about 16px on short viewports). Order: Like, Sources, Save (bookmark, filled when saved), Share, Sound. At 390px width the rail column is 54px, so everything stays inside the right 14% safe zone and the burned captions (14% margins) are unaffected; no change to the render lane contract.

## Profile, Ask history

- `/profile`: avatar initial, email, member since; Topics editor (`TopicChips`, shared with the first-run `TopicPicker`, 1 to 8, saved with a server action, ranks the feed through `profile.topics`); Sources switches (hn, github, reddit, youtube, papers, news; stored in `profile.sources`, empty means all, the last one cannot be turned off, the feed query keeps items with a mention from an enabled source); Liked and Saved tabs as 3-column poster grids that open `/?reel=<id>`; link to Ask history; sign out.
- Ask history: `/ask/history` lists the viewer's answered questions newest first, grouped by day, keyset paginated, one row per conversation (`ask_query.conversation_id`, set client-side per Ask session); `/ask/[id]` reopens the answer with a Related reels row (9:16 posters of reels behind the cited chunks that the feed would serve, linking to `/?reel=<id>`) and the source cards. Owner-only: every query filters `profile_id`, a foreign or deleted id is a 404. Delete is a soft delete (`deleted_at`) with inline confirm, so deleting cannot dodge the hourly Ask limit. Anonymous visitors see no history entry points.

## Reel caption

Instagram-like and minimal, bottom-left, clear of the right action rail (`pr-[16%]`) and the bottom safe area (`env(safe-area-inset-bottom)`). No boxes or chips.

- Collapsed: a 13px source line (dot, source name, domain), then the title at 15px semibold clamped to 2 lines on every viewport with a muted "more" inline at the end of the last line ("title text... more"). `ClampedTitle` measures a hidden twin and binary-searches the longest prefix that fits with the ellipsis and "more", re-running on resize. A faint bottom gradient (60% to 0) keeps it legible.
- Expanded: tapping the title button reveals the full TLDR (14px) and the source link in place; the gradient deepens (85%) and the block grows with a 300ms grid-rows plus opacity transition (the one allowed exception to transform/opacity-only transitions). Tapping the TLDR or "less" collapses it. The title button carries `aria-expanded`/`aria-controls`; collapsed details are `inert`.
- The caption stops click propagation so expanding never triggers the tap-to-pause or double-tap-like on the video. Expanded details scroll inside (`max-h-[calc(45cqh-5rem)]`, `overscroll-contain`).

## Auth cookies

Supabase session cookies use domain `AUTH_COOKIE_DOMAIN` (`.reelset.app` in production) so one login covers `reelset.app` and `admin.reelset.app`. The domain applies only when the request host is under it, so localhost and `*.vercel.app` stay host-only. See `src/lib/auth/cookie-options.ts`. Legacy host-only cookies are moved to the shared domain by `proxy.ts` once per browser (marker cookie `rs_auth_domain`); sign-out and the auth callback expire the host-only copies too.

## Admin tables

Every table has sortable headers (`SortTh`): a link with an arrow indicator and `aria-sort`; below `md` a "Sort by" select (`SortBar`) lists every column and direction. Sorting is server-side through `?sort=col&dir=asc|desc` (`ssort/sdir` for stuck items, `tsort/tdir` for ingest tasks), parsed by `parseSort` against a per-table whitelist (`*_SORT_KEYS` in `server/admin/queries.ts`); anything else falls back to the default (newest first). Sorting resets to page 1 and keeps filters. Spend, health and timeline tables are fixed-order summaries and are not sortable.

## Motion rules

- Transitions only on `transform`, `opacity`, color. Press feedback is `active:scale-90..98`.
- Entrances use `animate-fade-up` / `animate-sheet-up`; staggered by 60ms at most.
- Likes use the spring easing and a heart pop. Page navigation uses CSS View Transitions (`@view-transition`).
- `prefers-reduced-motion` collapses all animation and transition durations globally.

## Brand

Mark: a lime reel card with a play triangle over an offset outline card (a "set" of reels). Source: `src/app/icon.svg`. `scripts/generate-icons.mjs` regenerates `favicon.ico`, `apple-icon.png` and the PWA icons (any and maskable) in `public/`. The OG image is `src/app/opengraph-image.tsx`.

## Interaction

Feed: tap pauses, double tap likes, `Up/Down/J/K` browse, `Space` play or pause, `M` sound, `L` like. The next reel preloads (`preload=auto` for active and next). Video fades in over its poster to avoid flashes.
