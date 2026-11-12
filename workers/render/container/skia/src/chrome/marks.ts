import { Path2D } from '@napi-rs/canvas'
import { measure, rrect, setFont, text, type Ctx } from '../engine/draw'
import { COL } from '../engine/kit'
import type { Source } from '../plan'

/** Source glyph on a 24-unit grid at (x, y), `size` px square. */
export function glyph(
  c: Ctx,
  source: Source,
  x: number,
  y: number,
  size: number,
  light = false,
): void {
  c.save()
  c.translate(x, y)
  c.scale(size / 24, size / 24)
  const fg = light ? COL.ink : '#f4f4f5'
  switch (source) {
    case 'hn':
      rrect(c, 2, 2, 20, 20, 5)
      c.fillStyle = COL.hn
      c.fill()
      c.strokeStyle = '#fff'
      c.lineWidth = 2.2
      c.lineCap = 'round'
      c.lineJoin = 'round'
      c.stroke(new Path2D('M7 6.5 12 13.5 17 6.5M12 13.5V18'))
      break
    case 'github':
      c.strokeStyle = fg
      c.lineWidth = 1.8
      c.lineCap = 'round'
      for (const [cx, cy] of [
        [6.5, 5.5],
        [6.5, 18.5],
        [17.5, 9.5],
      ] as const) {
        c.beginPath()
        c.arc(cx, cy, 2.2, 0, Math.PI * 2)
        c.stroke()
      }
      c.stroke(new Path2D('M6.5 7.7v8.6M17.5 11.7c0 3-3.5 3.3-9.2 5.5'))
      break
    case 'reddit':
      c.beginPath()
      c.arc(12, 12, 10, 0, Math.PI * 2)
      c.fillStyle = COL.reddit
      c.fill()
      text(c, 'r/', 12, 16.2, 'ui', 12, '#fff', { align: 'center', weight: 800 })
      break
    case 'youtube':
      rrect(c, 1.5, 4.5, 21, 15, 4.5)
      c.fillStyle = COL.youtube
      c.fill()
      c.fillStyle = '#fff'
      c.fill(new Path2D('M10 9v6l5.2-3z'))
      break
    case 'papers':
      rrect(c, 3, 2.5, 18, 19, 3)
      c.fillStyle = COL.arxiv
      c.fill()
      c.strokeStyle = '#fff'
      c.lineWidth = 1.8
      c.lineCap = 'round'
      c.stroke(new Path2D('M7.5 8h9M7.5 11.5h9M7.5 15h5.5'))
      break
    default:
      rrect(c, 3, 3.5, 18, 17, 3)
      c.strokeStyle = fg
      c.lineWidth = 1.8
      c.stroke()
      c.lineCap = 'round'
      c.stroke(new Path2D('M7 8.5h10M7 12h10M7 15.5h6'))
  }
  c.restore()
}

/** Pill with the source glyph and label (the baseline's chip). Returns its width. */
export function chip(
  c: Ctx,
  source: Source,
  label: string,
  x: number,
  y: number,
  size: number,
  light = false,
): number {
  const w = chipWidth(label, size)
  const h = 36 * size + 2
  rrect(c, x, y, w, h, 999)
  c.fillStyle = light ? 'rgba(11,11,14,0.07)' : 'rgba(255,255,255,0.06)'
  c.fill()
  rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, 999)
  c.strokeStyle = light ? 'rgba(11,11,14,0.12)' : 'rgba(255,255,255,0.09)'
  c.lineWidth = 1
  c.stroke()
  glyph(c, source, x + 1 + 10 * size, y + (h - 20 * size) / 2, 20 * size, light)
  text(c, label, x + 1 + 40 * size, y + h / 2 + 1, 'ui', 16 * size, light ? COL.ink : '#f4f4f5', {
    baseline: 'middle',
    weight: 600,
    ls: 0.01,
  })
  return w
}

export const chipWidth = (label: string, size: number) =>
  40 * size + measure(label, 'ui', 16 * size, 0.01, 600) + 14 * size + 2

/** Lime square + "reelset", right-aligned at `xr`, vertically centered on `mid`. */
export function wordmark(c: Ctx, xr: number, mid: number, size = 1.5, light = false): void {
  const fs = 17 * size
  setFont(c, 'ui', fs, -0.01, 700)
  const tw = measure('reelset', 'ui', fs, -0.01, 700)
  const sq = 10 * size
  const gap = 8 * size
  const x = xr - (sq + gap + tw)
  rrect(c, x, mid - sq / 2, sq, sq, 3 * size)
  c.fillStyle = light ? COL.ink : COL.lime
  c.fill()
  text(c, 'reelset', x + sq + gap, mid + 1, 'ui', fs, light ? COL.ink : '#f4f4f5', {
    baseline: 'middle',
    weight: 700,
    ls: -0.01,
  })
}
