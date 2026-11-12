export const W = 1080
export const H = 1920
export const FPS = 24
/** The shot planner is tuned in 30 fps frames; plans are made at 30 and drawn by time. */
export const PLAN_FPS = 30

export const COL = {
  ink: '#0b0b0e',
  ink2: '#16161b',
  ink3: '#222229',
  bone: '#ece8dc',
  bone2: '#dcd7c8',
  lime: '#c8f751',
  limeInk: '#0b0d04',
  coral: '#ff5b3a',
  dim: '#8c8c95',
  white: '#f6f4ee',
  line: 'rgba(246,244,238,0.10)',
  lineInk: 'rgba(11,11,14,0.14)',
  hn: '#ff6600',
  reddit: '#ff4500',
  youtube: '#ff0033',
  arxiv: '#b31b1b',
} as const

export type Tone = 'dark' | 'light' | 'lime'

/** Ink and secondary colors for content drawn on a given page tone. */
export function inkOf(tone: Tone): { fg: string; sub: string; faint: string; accent: string } {
  if (tone === 'light')
    return { fg: COL.ink, sub: 'rgba(11,11,14,0.62)', faint: COL.lineInk, accent: COL.ink }
  if (tone === 'lime')
    return {
      fg: COL.limeInk,
      sub: 'rgba(11,13,4,0.66)',
      faint: 'rgba(11,13,4,0.16)',
      accent: COL.limeInk,
    }
  return { fg: COL.white, sub: 'rgba(246,244,238,0.62)', faint: COL.line, accent: COL.lime }
}

// Layout. The phone app overlays the top ~11% and the bottom ~18% (plus a right rail of buttons).
export const L = 96
export const R = W - 151
export const CONTENT_W = R - L
export const HEADER_Y = 165
export const CONTENT_TOP = 330
/** Screens keep their content above this line; the caption line sits below it. */
export const ZONE_BOTTOM = 1400
export const ZONE_H = ZONE_BOTTOM - CONTENT_TOP
export const CAPTION_BASE = 1530
export const HEADLINE_PAD = 250

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
/** Progress of `t` through [a, a + d], clamped to 0..1. */
export const pr = (t: number, a: number, d: number) =>
  d <= 0 ? (t >= a ? 1 : 0) : clamp((t - a) / d)
export const mix = (a: number, b: number, p: number) => a + (b - a) * p

// Easing: expo-out is the house ease for entries; no linear, no bounce/elastic.
export const eo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p))
export const eo3 = (p: number) => 1 - (1 - p) ** 3
export const eo4 = (p: number) => 1 - (1 - p) ** 4
export const ei4 = (p: number) => p ** 4
export const eio = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
/** Back-out, for stamps and markers only. */
export const eb = (p: number, s = 1.7) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2

/** Deterministic 0..1 noise from an integer seed (stable across frames and runs). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** Typed read of a planner prop with a fallback for missing or empty values. */
export function prop<T>(props: Record<string, unknown>, key: string, fallback: T): T {
  const v = props[key]
  return v === undefined || v === null || v === '' ? fallback : (v as T)
}

/** Count-up easing for numbers: lands exactly on `to` at `t0 + dur`. */
export const countAt = (t: number, t0: number, dur: number, to: number) => to * eo(pr(t, t0, dur))

export const grouped = (n: number) => Math.round(n).toLocaleString('en-US')
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${+(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`
  return grouped(n)
}
