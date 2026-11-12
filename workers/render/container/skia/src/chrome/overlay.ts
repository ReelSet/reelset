import type { Canvas } from '@napi-rs/canvas'
import { captionWord, highlightIndex, pageAt } from '@plan/lib/captions'
import { typeset } from '@plan/lib/typeset'
import { fitBlock, measure, rrect, sprite, text, wrap, type Ctx } from '../engine/draw'
import {
  CAPTION_BASE,
  COL,
  CONTENT_TOP,
  H,
  HEADER_Y,
  L,
  R,
  W,
  clamp,
  ei4,
  eo,
  mix,
  pr,
  type Tone,
} from '../engine/kit'
import type { Reel } from '../plan'
import { chip, wordmark } from './marks'

const SCALE = 1.45
const SEG_GAP = 8

/** Header: one progress segment per narration scene, the source chip and the reelset wordmark. */
export class Header {
  private sprites = new Map<string, Canvas>()
  constructor(private reel: Reel) {}

  private base(light: boolean): Canvas {
    const key = light ? 'light' : 'dark'
    let s = this.sprites.get(key)
    if (!s) {
      const { scenes, ctx } = this.reel
      const n = Math.max(1, scenes.length)
      const segW = (R - L - SEG_GAP * (n - 1)) / n
      s = sprite(W, 320, (g) => {
        if (!light) {
          const gr = g.createLinearGradient(0, 0, 0, 320)
          gr.addColorStop(0, 'rgba(9,9,11,0.7)')
          gr.addColorStop(0.7, 'rgba(9,9,11,0.45)')
          gr.addColorStop(1, 'rgba(9,9,11,0)')
          g.fillStyle = gr
          g.fillRect(0, 0, W, 320)
        }
        for (let i = 0; i < n; i++) {
          rrect(g, L + i * (segW + SEG_GAP), HEADER_Y, segW, 6, 3)
          g.fillStyle = light ? 'rgba(11,11,14,0.16)' : 'rgba(255,255,255,0.18)'
          g.fill()
        }
        const cy = HEADER_Y + 24
        chip(g, ctx.source, ctx.sourceLabel, L, cy, SCALE, light)
        wordmark(g, R - 16, cy + (36 * SCALE + 2) / 2, 1.5, light)
      })
      this.sprites.set(key, s)
    }
    return s
  }

  draw(c: Ctx, t: number, tone: Tone): void {
    const light = tone !== 'dark'
    c.drawImage(this.base(light), 0, 0)
    const { scenes } = this.reel
    const n = Math.max(1, scenes.length)
    const segW = (R - L - SEG_GAP * (n - 1)) / n
    c.fillStyle = light ? COL.ink : '#f4f4f5'
    scenes.forEach((s, i) => {
      const fill = clamp((t - s.t0) / Math.max(0.01, s.t1 - s.t0))
      if (fill <= 0) return
      const x = L + i * (segW + SEG_GAP)
      c.save()
      rrect(c, x, HEADER_Y, segW, 6, 3)
      c.clip()
      c.fillRect(x, HEADER_Y, segW * fill, 6)
      c.restore()
    })
  }
}

const CAP_W = 810
const CAP_MAX = 68
const CAP_MIN = 46
const CAP_LS = -0.025

type CapLayout = {
  size: number
  lines: { words: number[]; xs: number[]; ws: number[] }[]
  strs: string[]
}

/** Lower-third karaoke: the page's words rise in, spoken words go full white, the current word is lime with an underline. */
export class Captions {
  private layouts = new Map<number, CapLayout>()
  constructor(private reel: Reel) {}

  private layout(pi: number): CapLayout {
    let lay = this.layouts.get(pi)
    if (lay) return lay
    const strs = this.reel.pages[pi]!.map((w) => typeset(captionWord(w.text)))
    const whole = strs.join(' ')
    const { size } = fitBlock(whole, 'display', CAP_W, CAP_MAX * 2.3, {
      max: CAP_MAX,
      min: CAP_MIN,
      lh: 1.12,
      ls: CAP_LS,
      maxLines: 2,
    })
    const lineStrs = wrap(whole, 'display', size, CAP_W, CAP_LS)
    const gap = measure(' ', 'display', size, CAP_LS) + 6
    let wi = 0
    const lines = lineStrs.map((ls) => {
      const count = ls.split(' ').length
      const words = Array.from({ length: count }, (_, k) => wi + k)
      wi += count
      const ws = words.map((k) => measure(strs[k] ?? '', 'display', size, CAP_LS))
      const xs: number[] = []
      let x = L
      for (const w of ws) {
        xs.push(x)
        x += w + gap
      }
      return { words, xs, ws }
    })
    lay = { size, lines, strs }
    this.layouts.set(pi, lay)
    return lay
  }

  draw(c: Ctx, t: number, tone: Tone): void {
    const { pages } = this.reel
    const page = pageAt(pages, t, 0.25)
    if (!page) return
    const pi = pages.indexOf(page)
    const lay = this.layout(pi)
    const light = tone !== 'dark'
    const fullCol = light ? COL.ink : COL.white
    const upcoming = light ? 'rgba(11,11,14,0.30)' : 'rgba(246,244,238,0.32)'
    const nowCol = light ? COL.ink : COL.lime
    const prevPage = pages[pi - 1]
    const before = prevPage?.[prevPage.length - 1]?.text ?? ''
    const lit = highlightIndex(page, t, before)
    let cur = -1
    page.forEach((w, i) => {
      if (t >= w.start) cur = i
    })
    const appear = page[0]!.start - 0.16
    const lh = lay.size * 1.14
    const base0 = CAPTION_BASE - (lay.lines.length - 1) * lh
    if (!light) {
      c.save()
      const top = base0 - lay.size * 1.4
      const gr = c.createLinearGradient(0, top - 60, 0, CAPTION_BASE + 90)
      gr.addColorStop(0, 'rgba(9,9,11,0)')
      gr.addColorStop(0.35, 'rgba(9,9,11,0.55)')
      gr.addColorStop(1, 'rgba(9,9,11,0.55)')
      c.fillStyle = gr
      c.fillRect(0, top - 60, W, CAPTION_BASE + 150 - top)
      c.restore()
    }
    lay.lines.forEach((line, li) => {
      const base = base0 + li * lh
      line.words.forEach((wi, k) => {
        const p = eo(pr(t, appear + wi * 0.06, 0.32))
        if (p <= 0) return
        const w = page[wi]!
        const now = wi === cur
        const spoken = wi <= cur
        const pop = now ? 1 + 0.06 * Math.sin(Math.min(1, (t - w.start) / 0.18) * Math.PI) : 1
        const x = line.xs[k]!
        const ww = line.ws[k]!
        c.save()
        c.beginPath()
        c.rect(x - 30, base - lay.size * 1.02, ww + 60, lay.size * 1.42)
        c.clip()
        c.translate(x + ww / 2, base)
        c.scale(pop, pop)
        const col = now || (wi === lit && spoken) ? nowCol : spoken ? fullCol : upcoming
        text(c, lay.strs[wi] ?? '', -ww / 2, (1 - p) * lay.size * 0.9, 'display', lay.size, col, {
          ls: CAP_LS,
        })
        c.restore()
      })
    })
    if (cur >= 0) {
      const at = (wi: number) => {
        for (const [li, line] of lay.lines.entries()) {
          const k = line.words.indexOf(wi)
          if (k >= 0) return { x: line.xs[k]!, w: line.ws[k]!, y: base0 + li * lh }
        }
        return null
      }
      const curP = at(cur)
      const prevP = at(Math.max(0, cur - 1))
      if (curP && prevP) {
        const g = eo(pr(t - page[cur]!.start, 0, 0.2))
        const sameLine = curP.y === prevP.y
        const ux = sameLine ? mix(prevP.x, curP.x, g) : curP.x
        const uw = sameLine ? mix(prevP.w, curP.w, g) : curP.w
        c.save()
        c.globalAlpha = eo(pr(t, appear + 0.1, 0.3))
        rrect(c, ux, curP.y + 14, uw, 7, 3.5)
        c.fillStyle = nowCol
        c.fill()
        c.restore()
      }
    }
  }
}

/** The hook headline over the first shots: big uppercase words rising in, a lime bar drawing under them. */
export class Headline {
  private lines: string[] = []
  private size = 80
  constructor(private reel: Reel) {
    if (reel.headline) {
      const label = typeset(reel.headline.text).toUpperCase()
      const fitR = fitBlock(label, 'display', R - L, 200, {
        max: 104,
        min: 58,
        lh: 0.98,
        ls: -0.03,
        maxLines: 2,
      })
      this.lines = fitR.lines
      this.size = fitR.size
    }
  }

  draw(c: Ctx, t: number): void {
    const h = this.reel.headline
    if (!h || t >= h.t1 + 0.4) return
    const size = this.size
    const outAt = h.t1 - 0.28
    const top = CONTENT_TOP - 6
    let k = 0
    const space = measure(' ', 'display', size, -0.03)
    this.lines.forEach((line, li) => {
      const base = top + size * 0.86 + li * size * 0.98
      let x = L
      for (const word of line.split(' ')) {
        const p = eo(pr(t, 0.05 + k * 0.07, 0.5))
        const q = ei4(pr(t, outAt + k * 0.025, 0.28))
        k += 1
        const w = measure(word, 'display', size, -0.03)
        if (p > 0 && q < 1) {
          c.save()
          c.beginPath()
          c.rect(x - 30, base - size * 1.0, w + 60, size * 1.3)
          c.clip()
          const off = (1 - p) * size * 1.1 - q * size * 1.15
          text(c, word, x, base + off, 'display', size, COL.white, { ls: -0.03 })
          c.restore()
        }
        x += w + space
      }
    })
    const barY = top + size * 0.86 + (this.lines.length - 1) * size * 0.98 + 26
    const grow = eo(pr(t, 0.35, 0.55))
    const shrink = ei4(pr(t, outAt, 0.3))
    const barW = Math.min(R - L, measure(this.lines[0] ?? '', 'display', size, -0.03)) * 0.42
    if (grow > 0 && shrink < 1) {
      rrect(c, L + barW * shrink, barY, barW * (grow - shrink), 12, 6)
      c.fillStyle = COL.lime
      c.fill()
    }
  }
}

/** Vignette + static film grain over everything but the chrome. */
export class Finish {
  private vignette: Canvas
  private grain: ReturnType<Ctx['createPattern']> | null = null
  constructor(c: Ctx) {
    this.vignette = sprite(W, H, (g) => {
      const gr = g.createRadialGradient(W / 2, H * 0.47, H * 0.3, W / 2, H * 0.47, H * 0.78)
      gr.addColorStop(0, 'rgba(0,0,0,0)')
      gr.addColorStop(1, 'rgba(0,0,0,0.38)')
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
    })
    let seed = 7
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    const tile = sprite(512, 512, (g) => {
      const id = g.createImageData(512, 512)
      for (let i = 0; i < id.data.length; i += 4) {
        const v = rnd() > 0.5 ? 255 : 0
        id.data[i] = id.data[i + 1] = id.data[i + 2] = v
        id.data[i + 3] = 10 + rnd() * 3
      }
      g.putImageData(id, 0, 0)
    })
    this.grain = c.createPattern(tile, 'repeat')
  }

  draw(c: Ctx, tone: Tone): void {
    if (tone === 'dark') c.drawImage(this.vignette, 0, 0)
    if (this.grain) {
      c.fillStyle = this.grain
      c.fillRect(0, 0, W, H)
    }
  }
}
