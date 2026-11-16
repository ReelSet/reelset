# Sources on the reel end card

## Why

Reels should look researched. Every reel ends on a card that shows where the facts came from and
tells Instagram viewers the links are in the caption.

## Goals

- The end card lists the reel's top 2-3 sources as short domains, plus the line "Sources in the caption".
- Every reel ends on this card, including model-written (director) reels, which have no end card today.
- The card is on screen for at least 2.5 s and at most 3 s.
- The Instagram caption always keeps its `Source: <link>` line.

## Non-goals

- No auto comment, and no "comment SOURCE" DM flow. The user chose to keep sources in the caption.
- No new Instagram permissions or token changes.

## Anti-goals

- A long silent ending. Extra silence is added only when the narrated outro is shorter than 2.5 s.
- Clutter: at most 3 sources, one line each, never a full URL.

## Approaches considered

1. **Add sources to the existing end card (chosen).** It reads as research, adds almost no time,
   and reuses the card and its timing rules.
2. A separate silent sources card after the end card. Rejected: 2-3 s of silence lowers average
   watch percentage and breaks the loop back to the hook.
3. A small sources strip on the last narrated shot. Rejected: easy to miss, so it doesn't read as
   researched.

## Design

- **Picking the sources** (render worker, where the item's top 12 mentions are already loaded):
  the main source first (`endSource`: `github.com/owner/repo`, or the domain), then the
  highest-scored other mentions with a different host, shown via the same `display_domain` rules.
  Up to 3 in total. This is sent to the container as a new `sources: string[]` on the render input
  and passed through validation into `ReelProps`.
- **End card** (`skia/src/screens/core.ts` `EndCard`): under the subtitle, a small "Sources"
  label, then one line per source, then "Sources in the caption" in muted text, then the existing
  Follow pill. Everything still fits the same zone; the name block shrinks first if space runs out.
  With no sources, the card looks as it does today.
- **Director reels** (`skia/src/director/scene-reel.ts` `applyScenes`): the last model scene is
  cut short and the planner's EndCard is added after it, so these reels end the same way.
- **Timing**: the end card's 3 s cap (`END_CARD_MAX_S`) stays. When the card would be shorter than
  2.5 s, it starts earlier, taking the time from the shot before it, which keeps at least 1 s. This
  is a builder's call that replaces "grow the silent tail": the card already shows captions, so the
  narration keeps going over it and no silence is added.
- **Caption** (`packages/core/src/domain/instagram-caption.ts` `buildCaption`): when the caption is
  too long, credits and then hashtags are dropped before the `Source:` line, which is never dropped.

## Testing

- Vitest:
  - source picking (main first, dedupe by host, max 3);
  - `buildCaption` keeps `Source:` when trimming;
  - `applyScenes` ends with an EndCard;
  - the timing minimum.
- Python: validation passes `sources` through and rejects bad values.
- One local preview render of a normal reel and of a director reel, checked by eye.

## Left to the builder

- The exact font sizes and spacing on the card.
- How the last director scene is trimmed when it is already very short.
