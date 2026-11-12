import type { Canvas } from '@napi-rs/canvas'
import { sprite, type Ctx } from '../engine/draw'
import {
  COL,
  CONTENT_TOP,
  CONTENT_W,
  H,
  L,
  W,
  ZONE_BOTTOM,
  mix,
  pr,
  type Tone,
} from '../engine/kit'
import type { DrawArgs } from './types'

let grid: Canvas | null = null
const scrims = new Map<string, Canvas>()

function gridSprite(): Canvas {
  grid ??= sprite(W, H, (g) => {
    g.strokeStyle = 'rgba(246,244,238,0.035)'
    g.lineWidth = 1
    for (let x = 0; x <= W; x += 108) {
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, H)
      g.stroke()
    }
    for (let y = 0; y <= H; y += 108) {
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(W, y + 0.5)
      g.stroke()
    }
  })
  return grid
}

function scrim(strength: number): Canvas {
  const k = strength.toFixed(2)
  let s = scrims.get(k)
  if (!s) {
    s = sprite(W, H, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, H)
      gr.addColorStop(0, `rgba(11,11,14,${0.78 * strength})`)
      gr.addColorStop(0.35, `rgba(11,11,14,${0.5 * strength})`)
      gr.addColorStop(0.62, `rgba(11,11,14,${0.5 * strength})`)
      gr.addColorStop(1, `rgba(11,11,14,${0.86 * strength})`)
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
    })
    scrims.set(k, s)
  }
  return s
}

/** Full-frame image or video frame with a slow push-in (cover fit). */
export function coverDraw(
  c: Ctx,
  src: { width: number; height: number },
  t: number,
  dur: number,
  o: {
    zoom?: number
    focus?: { x: number; y: number }
    alpha?: number
    x?: number
    y?: number
    w?: number
    h?: number
  } = {},
): void {
  const bx = o.x ?? 0
  const by = o.y ?? 0
  const bw = o.w ?? W
  const bh = o.h ?? H
  const z = mix(1, o.zoom ?? 1.06, pr(t, 0, Math.max(dur, 0.5)))
  const k = Math.max(bw / src.width, bh / src.height) * z
  const dw = src.width * k
  const dh = src.height * k
  const fx = o.focus?.x ?? 0.5
  const fy = o.focus?.y ?? 0.5
  const x = bx + Math.min(0, Math.max(bw - dw, bw / 2 - dw * fx))
  const y = by + Math.min(0, Math.max(bh - dh, bh / 2 - dh * fy))
  c.save()
  if (o.alpha !== undefined) c.globalAlpha *= o.alpha
  c.drawImage(src as Canvas, x, y, dw, dh)
  c.restore()
}

/**
 * The page under a screen. Dark pages show the shot's stock clip (dimmed, scrimmed) when it has one,
 * and a faint 108 px grid. Light (bone) and lime pages are flat.
 */
export function page(
  a: DrawArgs,
  o: { tone?: Tone; backdrop?: number; grid?: boolean } = {},
): void {
  const { c } = a
  const tone = o.tone ?? 'dark'
  if (tone === 'light') {
    c.fillStyle = COL.bone
    c.fillRect(0, 0, W, H)
    return
  }
  if (tone === 'lime') {
    c.fillStyle = COL.lime
    c.fillRect(0, 0, W, H)
    return
  }
  c.fillStyle = COL.ink
  c.fillRect(0, 0, W, H)
  const bd = a.media.backdrop()
  if (bd) {
    coverDraw(c, bd, a.t, a.shot.dur, { zoom: 1.08, alpha: o.backdrop ?? 0.62 })
    c.drawImage(scrim(1), 0, 0)
  }
  if (o.grid !== false) c.drawImage(gridSprite(), 0, 0)
}

/** The content zone for a shot: below the header (and the headline card when it is up), above the captions. */
export function zone(a: Pick<DrawArgs, 'shot'>): { x: number; y: number; w: number; h: number } {
  const y = CONTENT_TOP + a.shot.topPad
  return { x: L, y, w: CONTENT_W, h: ZONE_BOTTOM - y }
}

/**
 * Draws `fn` (content laid out at natural size `w` x `h`) scaled down to fit inside the zone box,
 * anchored top-left (or centered vertically when `center`).
 */
export function fitInto(
  c: Ctx,
  box: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  fn: () => void,
  center = false,
): void {
  const k = Math.min(1, box.w / w, box.h / h)
  c.save()
  c.translate(box.x, center ? box.y + (box.h - h * k) / 2 : box.y)
  c.scale(k, k)
  fn()
  c.restore()
}
