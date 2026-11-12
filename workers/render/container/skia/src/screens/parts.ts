import { createCanvas, type Canvas } from '@napi-rs/canvas'
import {
  card,
  clip,
  fitBlock,
  measure,
  riseLines,
  rrect,
  sprite,
  text,
  type Ctx,
  type FontName,
} from '../engine/draw'
import { COL, H, W, eo, mix, pr } from '../engine/kit'
import { fitImage } from '@plan/lib/images'
import { windowAround } from '@plan/lib/text'
import { coverDraw } from './page'
import type { DrawArgs } from './types'
import type { Still } from '../engine/media'
import type { ReelImage } from '../plan'

export type Box = { x: number; y: number; w: number; h: number }

export const TONE_DIM = 'rgba(246,244,238,0.62)'
export const HAIR = 'rgba(246,244,238,0.10)'

/** Width of a pill holding `label` set in mono bold at `size`. */
export const pillWidth = (label: string, size: number) =>
  measure(label, 'monoB', size, 0.04) + size * 1.4

/** A mono label in a rounded pill. Returns its width. */
export function pill(
  c: Ctx,
  label: string,
  x: number,
  y: number,
  size: number,
  o: { fill?: string; fg?: string; stroke?: string | null; font?: FontName; maxW?: number } = {},
): number {
  label = clip(label, 'monoB', size, (o.maxW ?? 780) - size * 1.4, 0.04)
  const w = pillWidth(label, size)
  const h = size * 1.75
  card(c, x, y, w, h, {
    r: h / 2,
    fill: o.fill ?? 'rgba(246,244,238,0.07)',
    stroke: o.stroke ?? null,
  })
  text(c, label, x + w / 2, y + h / 2 + size * 0.02, o.font ?? 'monoB', size, o.fg ?? COL.white, {
    align: 'center',
    baseline: 'middle',
    ls: 0.04,
  })
  return w
}

export const pillHeight = (size: number) => size * 1.75

/** Flows pills left to right inside `maxW`, wrapping rows. Returns each pill's position and the total height. */
export function flowPills(
  labels: string[],
  size: number,
  maxW: number,
  gap = 14,
): { items: { label: string; x: number; y: number }[]; h: number } {
  const items: { label: string; x: number; y: number }[] = []
  let x = 0
  let y = 0
  const rowH = pillHeight(size)
  for (const label of labels) {
    const w = pillWidth(label, size)
    if (x > 0 && x + w > maxW) {
      x = 0
      y += rowH + gap
    }
    items.push({ label, x, y })
    x += w + gap
  }
  return { items, h: items.length ? y + rowH : 0 }
}

/** Draws `img` whole inside `box` (never cropped), rounded; returns the rectangle it covers. */
export function drawContain(
  c: Ctx,
  img: Still,
  box: Box,
  o: {
    r?: number
    fill?: string
    maxScale?: number
    scale?: number
    shiftX?: number
    shiftY?: number
  } = {},
): Box {
  const k = Math.min(box.w / img.width, box.h / img.height, o.maxScale ?? 4)
  const w = img.width * k
  const h = img.height * k
  const x = box.x + (box.w - w) / 2
  const y = box.y + (box.h - h) / 2
  c.save()
  rrect(c, x, y, w, h, o.r ?? 20)
  c.clip()
  if (o.fill) {
    c.fillStyle = o.fill
    c.fillRect(x, y, w, h)
  }
  c.drawImage(img as Canvas, x, y, w, h)
  c.restore()
  return { x, y, w, h }
}

/** Paints a soft, dimmed, full-frame copy of `src`: a tiny cover-fit (reused canvas) scaled up, no blur filter. */
export function paintSoft(
  c: Ctx,
  small: Canvas,
  src: { width: number; height: number },
  dim = 0.62,
): void {
  const g = small.getContext('2d')
  g.imageSmoothingQuality = 'high'
  const k = Math.max(small.width / src.width, small.height / src.height)
  g.drawImage(
    src as Canvas,
    (small.width - src.width * k) / 2,
    (small.height - src.height * k) / 2,
    src.width * k,
    src.height * k,
  )
  c.save()
  c.imageSmoothingQuality = 'high'
  c.drawImage(small, 0, 0, W, H)
  c.fillStyle = `rgba(11,11,14,${dim})`
  c.fillRect(0, 0, W, H)
  c.restore()
}

/** Static soft fill of an image, baked once into a sprite. */
export function softFill(src: { width: number; height: number }, dim = 0.62): Canvas {
  const small = createCanvas(54, 96)
  return sprite(W, H, (b) => paintSoft(b, small, src, dim))
}

/** Indexes of the words of `text` that make up `phrase` (first match, case-insensitive). */
export function phraseWords(textWords: string[], phrase: string | null | undefined): Set<number> {
  const out = new Set<number>()
  const want = (phrase ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (want.length === 0) return out
  const norm = (w: string) => w.toLowerCase().replace(/[.,;:!?"“”()]/g, '')
  for (let i = 0; i + want.length <= textWords.length; i++) {
    if (want.every((w, k) => norm(textWords[i + k] ?? '') === norm(w))) {
      for (let k = 0; k < want.length; k++) out.add(i + k)
      return out
    }
  }
  return out
}

/** Highlighter sweep behind the words of `marked` (flat word indexes over `lines`). */
export function markerSweep(
  c: Ctx,
  lines: string[],
  marked: Set<number>,
  x: number,
  top: number,
  font: FontName,
  size: number,
  lh: number,
  prog: number,
  ls = 0,
): void {
  if (prog <= 0 || marked.size === 0) return
  let k = 0
  const space = measure(' ', font, size, ls)
  lines.forEach((line, li) => {
    const words = line.split(' ')
    let wx = x
    let start = -1
    let end = 0
    words.forEach((word) => {
      const w = measure(word, font, size, ls)
      if (marked.has(k)) {
        if (start < 0) start = wx
        end = wx + w
      }
      wx += w + space
      k += 1
    })
    if (start < 0) return
    const y = top + li * size * lh + size * 0.56
    c.fillStyle = 'rgba(200,247,81,0.42)'
    rrect(c, start - 6, y, (end - start + 12) * prog, size * 0.36, 6)
    c.fill()
  })
}

/** A paragraph that rises in word by word, with an optional key phrase marked in lime. Returns its height. */
export function paragraph(
  c: Ctx,
  str: string,
  x: number,
  top: number,
  maxW: number,
  maxH: number,
  t: number,
  t0: number,
  o: {
    font?: FontName
    max?: number
    min?: number
    lh?: number
    ls?: number
    color?: string
    phrase?: string | null
    maxLines?: number
    layout?: { size: number; lines: string[] }
  } = {},
): number {
  const font = o.font ?? 'bold'
  const lh = o.lh ?? 1.22
  const ls = o.ls ?? 0
  const lay =
    o.layout ??
    fitBlock(str, font, maxW, maxH, {
      max: o.max ?? 56,
      min: o.min ?? 34,
      lh,
      ls,
      maxLines: o.maxLines ?? 12,
    })
  const words = lay.lines.join(' ').split(' ')
  const marked = phraseWords(words, o.phrase)
  markerSweep(c, lay.lines, marked, x, top, font, lay.size, lh, eo(pr(t, t0 + 0.5, 0.6)), ls)
  riseLines(c, lay.lines, x, top, font, lay.size, o.color ?? COL.white, t, t0, {
    lh,
    ls,
    step: Math.min(0.04, 0.7 / Math.max(1, words.length)),
  })
  return lay.lines.length * lay.size * lh
}

/** A quoted passage on a hairline card with a colored rule. Returns the card's height. */
export function quoteCard(
  c: Ctx,
  quote: string,
  by: string,
  color: string,
  box: Box,
  t: number,
  t0: number,
  lay: { size: number; lines: string[] },
  plain = false,
): number {
  const padX = 44
  const lh = 1.2
  const textH = lay.lines.length * lay.size * lh
  const h = Math.min(box.h, 120 + textH + 86)
  const p = eo(pr(t, t0, 0.5))
  c.save()
  c.globalAlpha = p
  c.translate(0, (1 - p) * 40)
  if (!plain) card(c, box.x, box.y, box.w, h, { r: 32, fill: COL.ink2 })
  rrect(c, box.x, box.y + 28, 8, h - 56, 4)
  c.fillStyle = color
  c.fill()
  text(c, '“', box.x + padX, box.y + 120, 'display', 150, color)
  c.restore()
  riseLines(c, lay.lines, box.x + padX, box.y + 100, 'bold', lay.size, COL.white, t, t0 + 0.12, {
    lh,
    step: 0.025,
  })
  const by0 = box.y + 100 + textH + 24
  c.save()
  c.globalAlpha = eo(pr(t, t0 + 0.4, 0.4))
  text(c, `— ${by}`, box.x + padX, by0 + 32, 'monoB', 30, TONE_DIM, { ls: 0.02 })
  c.restore()
  return h
}

/** Big stacked count with its noun (the spoken-number look of the HN and Reddit cards). */
export function countLine(
  c: Ctx,
  value: number,
  noun: string,
  color: string,
  x: number,
  base: number,
  maxW: number,
  t: number,
  t0: number,
): void {
  const shown = Math.round(value).toLocaleString('en-US')
  let size = 190
  while (
    size > 96 &&
    measure(shown, 'display', size, -0.04) + measure(noun, 'bold', 60) + 30 > maxW
  )
    size -= 6
  const w = measure(shown, 'display', size, -0.04)
  const p = eo(pr(t, t0, 0.6))
  c.save()
  c.globalAlpha = Math.min(1, p * 1.5)
  c.translate(0, (1 - p) * 50)
  text(c, shown, x, base, 'display', size, color, { ls: -0.04 })
  text(c, noun, x + w + 28, base, 'bold', 60, COL.white)
  c.restore()
}

/** The shot's source image (`props.image`, else the first one) with its metadata, or null when it did not decode. */
export function imageOf(a: {
  shot: { props: Record<string, unknown> }
  ctx: { images: ReelImage[] }
  media: { image(i: number): Still | null }
}): { img: Still; meta: ReelImage; i: number } | null {
  const raw = a.shot.props.image
  const want = typeof raw === 'number' ? raw : 0
  for (const i of [want, 0]) {
    const img = a.media.image(i)
    const meta = a.ctx.images[i]
    if (img && meta) return { img, meta, i }
  }
  return null
}

/**
 * A real source image: sharp, whole when it would otherwise be cropped or blown up (over a soft copy
 * of itself), filling the box otherwise, with a slow push-in. Clipped to `box`.
 */
export function drawPhoto(
  a: Pick<DrawArgs, 'c' | 't' | 'shot' | 'memo'>,
  img: Still,
  box: Box,
  o: {
    key: string
    focus?: { x: number; y: number }
    zoom?: number
    contain?: boolean
    backdrop?: boolean
    r?: number
    maxUp?: number
  },
): void {
  const { c, t, shot } = a
  const fit = fitImage(img.width, img.height, box.w, box.h)
  const whole = o.contain === true || fit.mode === 'contain'
  c.save()
  rrect(c, box.x, box.y, box.w, box.h, o.r ?? 0)
  c.clip()
  if (!whole) {
    coverDraw(c, img, t, shot.dur, { zoom: o.zoom ?? 1.08, focus: o.focus, ...box })
    c.restore()
    return
  }
  if (o.backdrop !== false)
    c.drawImage(
      a.memo(`soft:${o.key}`, () => softFill(img, 0.55)),
      0,
      0,
    )
  const k = Math.min((box.w * 0.92) / img.width, o.maxUp ?? 1.7, box.h / img.height)
  const dw = img.width * k
  const dh = img.height * k
  const zoom = Math.max(1, Math.min(o.zoom ?? 1.06, box.w / dw, box.h / dh))
  const z = mix(1, zoom, eo(pr(t, 0, Math.max(1, shot.dur))))
  c.drawImage(
    img as Canvas,
    box.x + (box.w - dw * z) / 2,
    box.y + (box.h - dh * z) / 2,
    dw * z,
    dh * z,
  )
  c.restore()
}

/** The longest window of `body` around `phrase` that fits `w` x `h` at a size of at least `min`. */
export function fitPassage(
  body: string,
  phrase: string | null,
  w: number,
  h: number,
  o: { max: number; min: number; lh: number; font?: FontName },
): { body: string; lay: { size: number; lines: string[] } } {
  const font = o.font ?? 'bold'
  let out = windowAround(body, phrase ?? '', 320)
  let lay = fitBlock(out, font, w, h, { max: o.max, min: o.min, lh: o.lh, maxLines: 14 })
  for (let n = 300; n >= 60 && lay.lines.length * lay.size * o.lh > h; n -= 20) {
    out = windowAround(body, phrase ?? '', n)
    lay = fitBlock(out, font, w, h, { max: o.max, min: o.min, lh: o.lh, maxLines: 14 })
  }
  return { body: out, lay }
}
