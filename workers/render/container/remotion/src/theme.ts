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
export const HEADER_H = 48
export const SAFE = { left: 56, right: 130, top: TOP_SAFE, bottom: Math.round(H * 0.18) } as const
export const CONTENT_W = W - SAFE.left - SAFE.right
export const CONTENT_TOP = TOP_SAFE + HEADER_H + 40

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
