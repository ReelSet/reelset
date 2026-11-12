import { createCanvas, GlobalFonts, Path2D, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ei4, eo, pr } from './kit'

export type Ctx = SKRSContext2D

function findAssets(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'assets', 'fonts'))) return path.join(dir, 'assets')
    dir = path.dirname(dir)
  }
  throw new Error('skia assets folder not found')
}
export const ASSETS = process.env.SKIA_ASSETS ?? findAssets()

const CJK = '"Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "DejaVu Sans", sans-serif'
/** Font stacks. Display/mono faces are Latin-only, so every stack falls back to CJK and DejaVu. */
export const F = {
  display: `BrikX, Geist, ${CJK}`,
  bold: `BrikB, Geist, ${CJK}`,
  ui: `Geist, ${CJK}`,
  mono: `MonoM, "Geist Mono", ${CJK}`,
  monoB: `MonoB, "Geist Mono", ${CJK}`,
  serif: `SerifI, Geist, ${CJK}`,
} as const
export type FontName = keyof typeof F

let fontsReady = false
export function registerFonts(dir = path.join(ASSETS, 'fonts')): void {
  if (fontsReady) return
  const reg = (file: string, family: string) =>
    GlobalFonts.registerFromPath(path.join(dir, file), family)
  reg('bricolage-grotesque-latin-800-normal.woff2', 'BrikX')
  reg('bricolage-grotesque-latin-700-normal.woff2', 'BrikB')
  reg('jetbrains-mono-latin-500-normal.woff2', 'MonoM')
  reg('jetbrains-mono-latin-700-normal.woff2', 'MonoB')
  reg('instrument-serif-latin-400-italic.woff2', 'SerifI')
  reg('geist.woff2', 'Geist')
  reg('geist-mono.woff2', 'Geist Mono')
  fontsReady = true
}

/** Geist is variable; `weight` only matters for the ui stack. */
export function setFont(c: Ctx, font: FontName, size: number, ls = 0, weight = 600): void {
  c.font = `${font === 'ui' ? `${weight} ` : ''}${size}px ${F[font]}`
  c.letterSpacing = `${(ls * size).toFixed(2)}px`
}

const scratch = createCanvas(8, 8).getContext('2d')
const widths = new Map<string, number>()
export function measure(str: string, font: FontName, size: number, ls = 0, weight = 600): number {
  const k = `${font}|${weight}|${size}|${ls}|${str}`
  let w = widths.get(k)
  if (w === undefined) {
    setFont(scratch, font, size, ls, weight)
    w = scratch.measureText(str).width
    if (widths.size > 8000) widths.clear()
    widths.set(k, w)
  }
  return w
}

export type TextOpts = {
  ls?: number
  align?: 'left' | 'center' | 'right'
  alpha?: number
  weight?: number
  baseline?: 'alphabetic' | 'middle' | 'top'
}
export function text(
  c: Ctx,
  str: string,
  x: number,
  y: number,
  font: FontName,
  size: number,
  color: string,
  o: TextOpts = {},
): void {
  setFont(c, font, size, o.ls ?? 0, o.weight)
  c.fillStyle = color
  c.textAlign = o.align ?? 'left'
  c.textBaseline = o.baseline ?? 'alphabetic'
  if (o.alpha !== undefined && o.alpha !== 1) {
    c.save()
    c.globalAlpha *= o.alpha
    c.fillText(str, x, y)
    c.restore()
  } else c.fillText(str, x, y)
  c.textBaseline = 'alphabetic'
}

/** Largest size in [min, max] (step 2) at which `str` fits on one line of `maxW`. */
export function fit(
  str: string,
  font: FontName,
  maxW: number,
  max: number,
  min = 20,
  ls = 0,
): number {
  let s = max
  while (s > min && measure(str, font, s, ls) > maxW) s -= 2
  return s
}

/** Greedy word wrap. A word longer than the line is broken by characters. */
export function wrap(str: string, font: FontName, size: number, maxW: number, ls = 0): string[] {
  const out: string[] = []
  let line = ''
  for (const word of str.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next, font, size, ls) <= maxW) {
      line = next
      continue
    }
    if (line) out.push(line)
    if (measure(word, font, size, ls) <= maxW) {
      line = word
      continue
    }
    let chunk = ''
    for (const ch of word) {
      if (measure(chunk + ch, font, size, ls) > maxW && chunk) {
        out.push(chunk)
        chunk = ''
      }
      chunk += ch
    }
    line = chunk
  }
  if (line) out.push(line)
  return out
}

/**
 * Largest size whose wrapped text fits `maxW` x `maxH` in at most `maxLines` lines.
 * Returns the size and the lines; at `min` the lines may still overflow and are clipped by the caller.
 */
export function fitBlock(
  str: string,
  font: FontName,
  maxW: number,
  maxH: number,
  { max = 120, min = 28, lh = 1.05, ls = 0, maxLines = 4 } = {},
): { size: number; lines: string[] } {
  for (let s = max; s >= min; s -= 2) {
    const lines = wrap(str, font, s, maxW, ls)
    if (
      lines.length <= maxLines &&
      lines.length * s * lh <= maxH &&
      lines.every((l) => measure(l, font, s, ls) <= maxW)
    )
      return { size: s, lines }
  }
  const lines = wrap(str, font, min, maxW, ls)
  return { size: min, lines: lines.slice(0, maxLines) }
}

/** Ellipsizes `str` to fit `maxW` on one line. */
export function clip(str: string, font: FontName, size: number, maxW: number, ls = 0): string {
  if (measure(str, font, size, ls) <= maxW) return str
  let lo = 0
  let hi = str.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(`${str.slice(0, mid).trimEnd()}…`, font, size, ls) <= maxW) lo = mid
    else hi = mid - 1
  }
  return `${str.slice(0, lo).trimEnd()}…`
}

/**
 * Masked rise: the text travels up out of a clipped line box (expo-out); optional masked exit at `out`.
 * Returns the drawn width.
 */
export function rise(
  c: Ctx,
  str: string,
  x: number,
  base: number,
  font: FontName,
  size: number,
  color: string,
  t: number,
  t0: number,
  o: {
    dur?: number
    ls?: number
    align?: 'left' | 'center' | 'right'
    out?: number | null
    outDur?: number
  } = {},
): number {
  const ls = o.ls ?? 0
  const w = measure(str, font, size, ls)
  const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
  const p = pr(t, t0, o.dur ?? 0.5)
  if (p <= 0) return w
  let off = (1 - eo(p)) * size * 1.1
  if (o.out !== undefined && o.out !== null) {
    const q = pr(t, o.out, o.outDur ?? 0.3)
    if (q >= 1) return w
    if (q > 0) off = -ei4(q) * size * 1.15
  }
  c.save()
  c.beginPath()
  c.rect(x0 - 40, base - size * 0.98, w + 80, size * 1.32)
  c.clip()
  text(c, str, x0, base + off, font, size, color, { ls })
  c.restore()
  return w
}

/** Word-staggered rise of several lines (each word enters `step` s after the previous). Returns the end time. */
export function riseLines(
  c: Ctx,
  lines: string[],
  x: number,
  top: number,
  font: FontName,
  size: number,
  color: string | ((line: number, word: number, str: string) => string),
  t: number,
  t0: number,
  o: { lh?: number; step?: number; dur?: number; ls?: number; align?: 'left' | 'center' } = {},
): number {
  const lh = o.lh ?? 1.05
  const ls = o.ls ?? 0
  const step = o.step ?? 0.06
  let k = 0
  lines.forEach((line, li) => {
    const base = top + size * 0.82 + li * size * lh
    const words = line.split(' ')
    const lw = measure(line, font, size, ls)
    let wx = o.align === 'center' ? x - lw / 2 : x
    const space = measure(' ', font, size, ls)
    words.forEach((word, wi) => {
      const col = typeof color === 'function' ? color(li, wi, word) : color
      const ww = rise(c, word, wx, base, font, size, col, t, t0 + k * step, {
        dur: o.dur ?? 0.5,
        ls,
      })
      wx += ww + space
      k += 1
    })
  })
  return t0 + k * step + (o.dur ?? 0.5)
}

export function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath()
  c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

/** A card: rounded fill with an optional hairline stroke and a soft drop shadow. */
export function card(
  c: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { r?: number; fill?: string; stroke?: string | null; shadow?: number } = {},
): void {
  const r = o.r ?? 28
  c.save()
  if (o.shadow) {
    c.shadowColor = `rgba(0,0,0,${o.shadow})`
    c.shadowBlur = 48
    c.shadowOffsetY = 18
  }
  rrect(c, x, y, w, h, r)
  c.fillStyle = o.fill ?? '#16161b'
  c.fill()
  c.restore()
  if (o.stroke !== null) {
    rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, r)
    c.strokeStyle = o.stroke ?? 'rgba(246,244,238,0.10)'
    c.lineWidth = 1.5
    c.stroke()
  }
}

/** Polyline draw-on (trim path) from 0..1 progress. */
export function strokeOn(
  c: Ctx,
  pts: [number, number][],
  prog: number,
  color: string,
  lw: number,
  close = false,
): void {
  if (prog <= 0 || pts.length < 2) return
  const p = new Path2D()
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)))
  if (close) p.closePath()
  let len = 0
  for (let i = 1; i < pts.length; i++)
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  if (close) len += Math.hypot(pts[0]![0] - pts.at(-1)![0], pts[0]![1] - pts.at(-1)![1])
  c.save()
  c.strokeStyle = color
  c.lineWidth = lw
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.setLineDash(prog >= 1 ? [] : [len * prog, len + 40])
  c.stroke(p)
  c.restore()
}

type IconPart = { p: Path2D; len: number }
let icons: Record<string, IconPart[]> | null = null
function iconSet(): Record<string, IconPart[]> {
  if (!icons) {
    const raw = JSON.parse(readFileSync(path.join(ASSETS, 'icons.json'), 'utf8')) as Record<
      string,
      { d: string; len: number }[]
    >
    icons = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, v.map((s) => ({ p: new Path2D(s.d), len: s.len }))]),
    )
  }
  return icons
}
export const hasIcon = (name: string) => name in iconSet()

/** Lucide line icon (24-unit grid) at (x, y) sized `size`, drawn on by `prog` 0..1. */
export function icon(
  c: Ctx,
  name: string,
  x: number,
  y: number,
  size: number,
  prog: number,
  color: string,
  lw = 2,
): void {
  const parts = iconSet()[name]
  if (!parts || prog <= 0) return
  const total = parts.reduce((a, b) => a + b.len, 0)
  let run = prog * total
  c.save()
  c.translate(x, y)
  c.scale(size / 24, size / 24)
  c.strokeStyle = color
  c.lineWidth = lw
  c.lineCap = 'round'
  c.lineJoin = 'round'
  for (const { p, len } of parts) {
    const take = Math.min(run, len)
    run -= len
    if (take <= 0.01) break
    c.setLineDash(take >= len - 0.01 ? [] : [take, len + 50])
    c.stroke(p)
  }
  c.restore()
}

/** Offscreen canvas drawn once by `fn`. */
export function sprite(w: number, h: number, fn: (g: Ctx) => void): Canvas {
  const cv = createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))
  fn(cv.getContext('2d'))
  return cv
}
