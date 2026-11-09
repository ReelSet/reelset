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

// App chrome covers the bottom ~22% and the right ~15% of the frame: keep content out of both.
export const SAFE = { left: 44, right: 112, top: 56, bottom: 282 } as const
export const CONTENT_W = W - SAFE.left - SAFE.right
export const SCENE_TOP = 140
export const SCENE_H = 610
export const CAPTION_TOP = 782
export const CAPTION_H = 170
export const OVERLAP = 8
