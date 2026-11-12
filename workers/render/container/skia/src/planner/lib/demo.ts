import { CONTENT_W, H, PANEL_TOP, SAFE } from '../theme'
import type { ReelDemo } from './types'

/** The demo window fills at least this share of the frame height. */
export const DEMO_MIN_HEIGHT_SHARE = 0.6
export const DEMO_WINDOW_H = Math.round(H * 0.64)
/** Longest the demo plays in a reel, in two cuts with different crops; shortest worth showing. */
export const DEMO_MIN_S = 3
export const DEMO_MAX_S = 4.5
/** Slow push-in over a cut, anchored at the window's top-left so the heading never moves out. */
export const DEMO_PUSH = 0.05

export type DemoPart = {
  /** Video size in px and the offset of its top-left corner inside the window, at the start and the end of the cut. */
  videoWidth: number
  videoHeight: number
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export type DemoLayout = {
  left: number
  top: number
  width: number
  height: number
  parts: [DemoPart, DemoPart]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Two crops of one README demo, each filling a window inside the safe box (x 11-86%, from below the
 * chrome, 64% of the frame tall) so the UI is large enough to read on a phone, never a letterboxed strip.
 * Cut 1 starts at the left edge of the demo's content, so its heading is never cut at the start, and
 * stays there (a pan would slide the heading out of the window); cut 2 zooms closer on the densest
 * region. Both only push in slowly (`DEMO_PUSH`, anchored top-left). A static demo zooms on that region only.
 */
export function demoLayout(
  demo: Pick<ReelDemo, 'width' | 'height' | 'focus' | 'content' | 'static'>,
  top = PANEL_TOP,
): DemoLayout {
  const iw = demo.width ?? 1280
  const ih = demo.height ?? 720
  const width = CONTENT_W
  const height = DEMO_WINDOW_H
  const focus = demo.focus ?? { x: 0.5, y: 0.5 }
  const content = demo.content ?? { x0: 0, x1: 1 }
  const make = (zoom: number, startX: number, endX: number, fy: number): DemoPart => {
    const scale = Math.max(height / ih, width / iw) * zoom
    const videoWidth = Math.round(iw * scale)
    const videoHeight = Math.round(ih * scale)
    const maxX = Math.max(0, videoWidth - width)
    const maxY = Math.max(0, videoHeight - height)
    const at = (share: number) => -clamp(share * videoWidth, 0, maxX)
    const y = -clamp(fy * videoHeight - height / 2, 0, maxY)
    return { videoWidth, videoHeight, from: { x: at(startX), y }, to: { x: at(endX), y } }
  }
  const visible = width / Math.round(iw * Math.max(height / ih, width / iw))
  const fits = content.x1 - content.x0 <= visible
  const open = fits ? (content.x0 + content.x1) / 2 - visible / 2 : content.x0
  const close = clamp(focus.x - visible / 1.3 / 2, 0, 1)
  const zoom = demo.static ? 1.25 : 1.3
  return {
    left: SAFE.left,
    top,
    width,
    height,
    parts: [
      make(demo.static ? zoom : 1, open, open, demo.static ? focus.y : 0.5),
      make(
        zoom * (demo.static ? 1.2 : 1),
        demo.static ? close : open,
        demo.static ? close : open,
        focus.y,
      ),
    ],
  }
}

/** Offset of a part's video inside the window at progress `p` (0-1) of that cut. */
export function demoOffset(part: DemoPart, p: number): { x: number; y: number } {
  return {
    x: part.from.x + (part.to.x - part.from.x) * p,
    y: part.from.y + (part.to.y - part.from.y) * p,
  }
}

/** Share of the source width each side of the window shows at progress `p`: for tests and heading checks. */
export function demoSpan(part: DemoPart, width: number, p: number): { x0: number; x1: number } {
  const off = demoOffset(part, p)
  return { x0: -off.x / part.videoWidth, x1: (-off.x + width) / part.videoWidth }
}
