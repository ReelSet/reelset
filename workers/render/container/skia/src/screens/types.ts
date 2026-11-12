import type { Canvas } from '@napi-rs/canvas'
import type { Ctx } from '../engine/draw'
import type { Tone } from '../engine/kit'
import type { Still, VideoSpec } from '../engine/media'
import type { Reel, ReelCtx, Shot } from '../plan'

/** Per-shot services handed to a screen on every frame. */
export type Media = {
  /** Decoded `ctx.images[i]` (null when missing or undecodable). */
  image(i: number): Still | null
  /** Decoded file under the job's assets folder (preloaded in `prepare`), e.g. 'cover.jpg'. */
  file(rel: string): Still | null
  /** Current frame of the shot's video (its `video()` spec), or null when it has none or it is not ready. */
  video(): Canvas | null
  /** Current frame of the stock clip behind the shot (graded, 720x1280), or null. */
  backdrop(): Canvas | null
}

export type DrawArgs = {
  c: Ctx
  /** Seconds since the shot started (0 at its first frame). */
  t: number
  /** Seconds since the reel started. */
  abs: number
  shot: Shot
  reel: Reel
  ctx: ReelCtx
  media: Media
  /** Memoizes per shot (cleared when the shot ends): sprites, layouts, anything costly to rebuild per frame. */
  memo<T>(key: string, make: () => T): T
}

export type Screen = {
  /** Page tone for the header and caption colors (default 'dark'). */
  tone?: (shot: Shot, reel: Reel) => Tone
  /** A video the screen plays (besides the stock backdrop), decoded for the shot's span. */
  video?: (shot: Shot, reel: Reel) => VideoSpec | null
  /** Asset files (relative to assets/) to decode before the shot, e.g. a cover or a figure. */
  files?: (shot: Shot, reel: Reel) => string[]
  /** Async work before the first frame of the shot (e.g. typesetting an equation to an image). */
  prepare?: (shot: Shot, reel: Reel) => Promise<void>
  /** False hides the caption line for this shot (a full-screen title that already says the words). */
  captions?: (shot: Shot, reel: Reel) => boolean
  draw(a: DrawArgs): void
}
