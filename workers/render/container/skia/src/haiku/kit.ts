import { createCanvas, Path2D, type Canvas } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { glyph, chip } from '../chrome/marks'
import { ASSETS, type Ctx } from '../engine/draw'
import { COL as BASE, H, W } from '../engine/kit'
import type { Still } from '../engine/media'
import type { Source } from '../plan'

/**
 * The drawing kit handed to model-written scene code: the same API the hand-made motion-v2 reel used
 * (a current context in S.c, text/rise/icon/stroke helpers, expo easing), plus job media.
 */
export const S: { c: Ctx } = { c: null as unknown as Ctx }
export const COL = {
  ink: BASE.ink,
  ink2: BASE.ink2,
  bone: BASE.bone,
  lime: BASE.lime,
  coral: BASE.coral,
  dim: BASE.dim,
  white: BASE.white,
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const pr = (t: number, a: number, d: number) => clamp((t - a) / d)
export const eo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p))
export const eo3 = (p: number) => 1 - (1 - p) ** 3
export const eo4 = (p: number) => 1 - (1 - p) ** 4
export const ei4 = (p: number) => p ** 4
export const eio = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
export const eb = (p: number, s = 1.7) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2
export const mix = (a: number, b: number, p: number) => a + (b - a) * p

const FAMS: Record<string, string> = {
  BrikX: 'BrikX, Geist, "Noto Sans CJK SC", sans-serif',
  BrikB: 'BrikB, Geist, "Noto Sans CJK SC", sans-serif',
  MonoM: 'MonoM, "Geist Mono", monospace',
  MonoB: 'MonoB, "Geist Mono", monospace',
  SerifI: 'SerifI, Geist, serif',
  Geist: '600 Geist, sans-serif',
}
export function font(fam: string, size: number, ls = 0): void {
  const stack = FAMS[fam] ?? FAMS.BrikB!
  S.c.font = stack.startsWith('600 ') ? `600 ${size}px ${stack.slice(4)}` : `${size}px ${stack}`
  S.c.letterSpacing = `${(ls * size).toFixed(2)}px`
}
const mc = createCanvas(8, 8).getContext('2d')
const wCache = new Map<string, number>()
export function measure(str: string, fam: string, size: number, ls = 0): number {
  const k = `${fam}|${size}|${ls}|${str}`
  let w = wCache.get(k)
  if (w === undefined) {
    const prev = S.c
    S.c = mc
    font(fam, size, ls)
    w = mc.measureText(String(str)).width
    S.c = prev
    if (wCache.size > 6000) wCache.clear()
    wCache.set(k, w)
  }
  return w
}
export function fit(str: string, fam: string, maxW: number, max: number, min = 20, ls = 0): number {
  let s = max
  while (s > min && measure(str, fam, s, ls) > maxW) s -= 2
  return s
}
type TOpts = { ls?: number; align?: CanvasTextAlign; alpha?: number }
export function text(
  str: string,
  x: number,
  y: number,
  fam: string,
  size: number,
  color: string,
  o: TOpts = {},
): void {
  const c = S.c
  font(fam, size, o.ls ?? 0)
  c.fillStyle = color
  c.textAlign = o.align ?? 'left'
  c.textBaseline = 'alphabetic'
  if (o.alpha !== undefined && o.alpha !== 1) {
    c.save()
    c.globalAlpha *= o.alpha
    c.fillText(String(str), x, y)
    c.restore()
  } else c.fillText(String(str), x, y)
}
/** Greedy word wrap to `maxW`; returns lines. */
export function wrap(str: string, fam: string, size: number, maxW: number, ls = 0): string[] {
  const out: string[] = []
  let line = ''
  for (const word of String(str).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (measure(next, fam, size, ls) <= maxW || !line) line = next
    else {
      out.push(line)
      line = word
    }
  }
  if (line) out.push(line)
  return out
}
type RiseOpts = {
  dur?: number
  ls?: number
  align?: 'left' | 'center' | 'right'
  dist?: number
  out?: number | null
  outDur?: number
}
export function rise(
  str: string,
  x: number,
  base: number,
  size: number,
  fam: string,
  color: string,
  t: number,
  t0: number,
  o: RiseOpts = {},
): number {
  const ls = o.ls ?? 0
  const w = measure(str, fam, size, ls)
  const x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
  const p = pr(t, t0, o.dur ?? 0.5)
  if (p <= 0) return w
  let off = (1 - eo(p)) * size * (o.dist ?? 1.1)
  if (o.out !== undefined && o.out !== null) {
    const q = pr(t, o.out, o.outDur ?? 0.3)
    if (q >= 1) return w
    if (q > 0) off = -ei4(q) * size * 1.15
  }
  const c = S.c
  c.save()
  c.beginPath()
  c.rect(x0 - 40, base - size * 0.98, w + 80, size * 1.32)
  c.clip()
  text(str, x0, base + off, fam, size, color, { ls })
  c.restore()
  return w
}
export function riseChars(
  str: string,
  x: number,
  base: number,
  size: number,
  fam: string,
  color: string,
  t: number,
  t0: number,
  o: { step?: number; dur?: number; ls?: number; align?: 'left' | 'center' } = {},
): number {
  const ls = o.ls ?? 0
  const w = measure(str, fam, size, ls)
  let cx = o.align === 'center' ? x - w / 2 : x
  for (let i = 0; i < str.length; i++) {
    rise(str[i]!, cx, base, size, fam, color, t, t0 + i * (o.step ?? 0.026), { dur: o.dur ?? 0.5 })
    cx += measure(str.slice(0, i + 1), fam, size, ls) - measure(str.slice(0, i), fam, size, ls)
  }
  return w
}
export function rrect(x: number, y: number, w: number, h: number, r: number): void {
  S.c.beginPath()
  S.c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}
export function bg(color: string): void {
  S.c.fillStyle = color
  S.c.fillRect(0, 0, W, H)
}

type Part = { p: Path2D; len: number }
const ICONS: Record<string, Part[]> = Object.fromEntries(
  Object.entries(
    JSON.parse(readFileSync(path.join(ASSETS, 'icons.json'), 'utf8')) as Record<
      string,
      { d: string; len: number }[]
    >,
  ).map(([k, v]) => [k, v.map((s) => ({ p: new Path2D(s.d), len: s.len }))]),
)
export const ICON_NAMES = Object.keys(ICONS).sort()
/** Lucide line icon at (x, y) top-left, `size` px, drawn on by `prog` 0..1 (trim path). */
export function icon(
  name: string,
  x: number,
  y: number,
  size: number,
  prog: number,
  color: string,
  lw = 2,
): void {
  const parts = ICONS[name]
  if (!parts || prog <= 0) return
  const c = S.c
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
export function polyLen(pts: [number, number][]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  return l
}
/** Polyline draw-on: `prog` 0..1 of the path length. */
export function stroke(
  pts: [number, number][],
  prog: number,
  color: string,
  lw: number,
  o: { dx?: number; dy?: number; close?: boolean } = {},
): void {
  if (prog <= 0 || pts.length < 2) return
  const c = S.c
  const p = new Path2D()
  pts.forEach(([x, y], i) =>
    i ? p.lineTo(x + (o.dx ?? 0), y + (o.dy ?? 0)) : p.moveTo(x + (o.dx ?? 0), y + (o.dy ?? 0)),
  )
  if (o.close) p.closePath()
  const len =
    polyLen(pts) +
    (o.close ? Math.hypot(pts[0]![0] - pts.at(-1)![0], pts[0]![1] - pts.at(-1)![1]) : 0)
  c.save()
  c.strokeStyle = color
  c.lineWidth = lw
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.setLineDash(prog >= 1 ? [] : [len * prog, len + 40])
  c.stroke(p)
  c.restore()
}
export function mk(w: number, h: number, fn: (g: Ctx) => void): Canvas {
  const cv = createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))
  const prev = S.c
  S.c = cv.getContext('2d')
  fn(S.c)
  S.c = prev
  return cv
}
/** Draws an image or video frame cover-fit into the box (default full frame) with zoom `k` about focus (fx, fy). */
export function cover(
  img: Still | Canvas | null,
  k = 1,
  fx = 0.5,
  fy = 0.5,
  box: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: W, h: H },
): void {
  if (!img) return
  const c = S.c
  const s = Math.max(box.w / img.width, box.h / img.height) * k
  const dw = img.width * s
  const dh = img.height * s
  const x = box.x + Math.min(0, Math.max(box.w - dw, box.w / 2 - dw * fx))
  const y = box.y + Math.min(0, Math.max(box.h - dh, box.h / 2 - dh * fy))
  c.save()
  c.beginPath()
  c.rect(box.x, box.y, box.w, box.h)
  c.clip()
  c.drawImage(img as Canvas, x, y, dw, dh)
  c.restore()
}
/** Whole image contained in the box (no crop). Returns the drawn rect. */
export function contain(
  img: Still | Canvas | null,
  box: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  if (!img) return null
  const s = Math.min(box.w / img.width, box.h / img.height)
  const w = img.width * s
  const h = img.height * s
  const r = { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
  S.c.drawImage(img as Canvas, r.x, r.y, r.w, r.h)
  return r
}
const blurCache = new Map<Still, Canvas>()
/** Full-frame blurred, dimmed copy of an image (built once), for behind a contained card. */
export function blurred(img: Still | null): Canvas | null {
  if (!img) return null
  let b = blurCache.get(img)
  if (!b) {
    const sm = createCanvas(27, 48)
    const sg = sm.getContext('2d')
    const s = Math.max(27 / img.width, 48 / img.height)
    sg.drawImage(
      img as Canvas,
      13.5 - (img.width * s) / 2,
      24 - (img.height * s) / 2,
      img.width * s,
      img.height * s,
    )
    b = mk(W, H, (g) => {
      g.imageSmoothingQuality = 'high'
      g.drawImage(sm, 0, 0, W, H)
      g.fillStyle = 'rgba(11,11,14,0.72)'
      g.fillRect(0, 0, W, H)
    })
    blurCache.set(img, b)
  }
  return b
}
export function sourceGlyph(
  source: Source,
  x: number,
  y: number,
  size: number,
  light = false,
): void {
  glyph(S.c, source, x, y, size, light)
}
export function sourceChip(
  source: Source,
  label: string,
  x: number,
  y: number,
  size = 1.6,
  light = false,
): number {
  return chip(S.c, source, label, x, y, size, light)
}
export { W, H, Path2D }
