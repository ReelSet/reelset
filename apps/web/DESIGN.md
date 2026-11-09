# Reelset design system

Dark, minimal, content-first. The reel is the hero; chrome is glass, quiet, and gets out of the way.
One accent color, used sparingly for primary actions and progress.

## References (Mobbin)

- Short-video feeds (TikTok, Instagram Reels, YouTube Shorts): right-hand action rail with icon over count, caption bottom-left with a "more" affordance, thin progress bar, minimal top chrome.
- Perplexity: answer first, numbered source cards, a pill composer pinned at the bottom for follow-ups, suggested questions as rows or chips.
- Linear: dense 13px tables, grouped status dots, quiet hairline borders, filter chips, left sidebar navigation.

## Tokens (defined in `src/app/globals.css` `@theme`)

| Group   | Tokens                                                                              |
| ------- | ----------------------------------------------------------------------------------- |
| Surface | `bg #09090b`, `surface #111114`, `raised #19191e`, `hover #202026`                   |
| Line    | `line` 8% white, `line-strong` 16% white                                             |
| Text    | `fg #f4f4f5`, `muted #a1a1aa`, `faint #71717a`                                       |
| Accent  | `accent #c8f751` with `accent-fg #0b0d04`                                            |
| Status  | `ok #5fdc9a`, `warn #f5b84b`, `danger #ff6b6b`, `info #6cb6ff`                       |
| Source  | `src-hn`, `src-reddit`, `src-youtube`, `src-github`, `src-news` (dots next to names) |
| Radius  | `sm 8`, `md 12`, `lg 20`, pills `full`; sheets 28                                    |
| Motion  | `fast 120ms`, `base 220ms`, `slow 420ms`; `ease-out` expo-out, `ease-spring` overshoot |

## Type

Geist Sans and Geist Mono via `next/font` (swap, no layout shift). Scale: 11 (labels, chips), 13 (admin, reel meta), 14 to 16 (body, reel caption), 15 (reel title), 28 to 44 (page headings). Headings use `tracking-tight` and `text-wrap: balance`.

## Layout

- Feed: full-height snap scroller. Phones: edge to edge, `object-fit: cover`, safe-area insets. Desktop (lg): centered 9:16 column sized from viewport height, rounded and hairline bordered, brand and nav on the left, prev/next and keyboard legend on the right.
- Ask and Profile: single 42rem column. Admin: 14rem sidebar plus content up to 72rem.

## Reel caption

Instagram-like and minimal, bottom-left, clear of the right action rail (`pr-[4.25rem]`) and the bottom safe area (`env(safe-area-inset-bottom)`). No boxes or chips.

- Collapsed: a 13px source line (dot, source name, domain), then the title at 15px semibold clamped to 2 lines with a muted "more". A faint bottom gradient (60% to 0) keeps it legible.
- Expanded: tapping the title button reveals the full TLDR (14px) and the source link in place; the gradient deepens (85%) and the block grows with a 300ms grid-rows plus opacity transition (the one allowed exception to transform/opacity-only transitions). Tapping the TLDR or "less" collapses it. The title button carries `aria-expanded`/`aria-controls`; collapsed details are `inert`.
- The caption stops click propagation so expanding never triggers the tap-to-pause or double-tap-like on the video. Expanded details scroll inside (`max-h-[38vh]`, `overscroll-contain`).

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
