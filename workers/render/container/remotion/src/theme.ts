export const W = 1080
export const H = 1920
export const FPS = 30

export const COLOR = {
  bg: '#09090b',
  surface: '#111114',
  surface2: '#17171b',
  line: 'rgba(255,255,255,0.09)',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  dim: '#6b6b74',
  accent: '#c8f751',
  accentInk: '#0b0d04',
  hn: '#ff6600',
  reddit: '#ff4500',
  youtube: '#ff0033',
  arxiv: '#b31b1b',
} as const

export const FONT = 'Geist, "Helvetica Neue", Arial, sans-serif'
export const MONO = '"Geist Mono", ui-monospace, Menlo, monospace'

// Mobile app header overlays the top ~11%: burned chrome starts at 12% of the frame height.
export const TOP_SAFE = Math.ceil(H * 0.12)
// 390x844 phones crop ~9% of each side of a cover-fit 9:16 video, the app's action rail covers the
// right 14%: burned content stays inside x in [11%, 86%].
export const SAFE = {
  left: Math.ceil(W * 0.11),
  right: Math.ceil(W * 0.14),
  top: TOP_SAFE,
  bottom: Math.round(H * 0.18),
} as const
export const CONTENT_W = W - SAFE.left - SAFE.right
// Chrome: 6 px progress bar, 18 px gap, 1.45x source chip (36 px tall). Nothing a screen draws may start above it.
export const CHROME_SCALE = 1.45
export const HEADER_H = 6 + 18 + Math.ceil(36 * CHROME_SCALE)
export const CHROME_BOTTOM = TOP_SAFE + HEADER_H
/** Top edge for full-width panels (HN banner, terminal, code editor): clear of the chrome. */
export const PANEL_TOP = CHROME_BOTTOM + 22
export const CONTENT_TOP = CHROME_BOTTOM + 40
/** Burned content never goes below this line (the app's caption and action overlay). */
export const BOTTOM_LIMIT = Math.floor(H * 0.88)

// Karaoke band: 58-72% of frame height, centered, 72% wide (clear of the right rail), two lines max.
export const CAPTION_BAND = { topPct: 0.58, bottomPct: 0.72, widthPct: 0.72 } as const
export const CAPTION_TOP = Math.round(H * CAPTION_BAND.topPct)
export const CAPTION_H = Math.round(H * CAPTION_BAND.bottomPct) - CAPTION_TOP
export const CAPTION_W = Math.floor((W * CAPTION_BAND.widthPct) / 2) * 2
export const CAPTION_LEFT = Math.round((W - CAPTION_W) / 2)
export const CAPTION_FONT = 72
export const CAPTION_LINE_HEIGHT = 1.12
export const CAPTION_MAX_LINES = 2

// Screens keep primary content above the caption band and a secondary strip below it.
export const ZONE_BOTTOM = CAPTION_TOP - 24
export const ZONE_H = ZONE_BOTTOM - CONTENT_TOP
export const LOW_TOP = CAPTION_TOP + CAPTION_H + 28
export const LOW_BOTTOM = H - SAFE.bottom
export const HEADLINE_PAD = 270
