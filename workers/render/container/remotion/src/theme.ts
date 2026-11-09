export const W = 720
export const H = 1280
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
} as const

export const FONT = 'Geist, "Helvetica Neue", Arial, sans-serif'
export const MONO = '"Geist Mono", ui-monospace, Menlo, monospace'

// App chrome covers the bottom ~18% and the right ~14% of the frame: keep content out of both.
export const SAFE = { left: 44, right: 112, top: 56, bottom: 282 } as const
export const CONTENT_W = W - SAFE.left - SAFE.right
export const SCENE_TOP = 140

// Karaoke band: 58-72% of frame height, centered, 72% wide (14% margins, clear of the right rail), two lines max.
export const CAPTION_BAND = { topPct: 0.58, bottomPct: 0.72, widthPct: 0.72 } as const
export const CAPTION_TOP = Math.round(H * CAPTION_BAND.topPct)
export const CAPTION_H = Math.round(H * CAPTION_BAND.bottomPct) - CAPTION_TOP
export const CAPTION_W = Math.round(W * CAPTION_BAND.widthPct)
export const CAPTION_LEFT = Math.round((W - CAPTION_W) / 2)
export const CAPTION_FONT = 40
export const CAPTION_LINE_HEIGHT = 1.18
export const CAPTION_MAX_LINES = 2

// Scene content ends above the caption band.
export const SCENE_GAP = 16
export const SCENE_BOTTOM = CAPTION_TOP - SCENE_GAP
export const SCENE_H = SCENE_BOTTOM - SCENE_TOP
export const OVERLAP = 8
