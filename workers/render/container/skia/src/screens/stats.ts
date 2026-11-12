import { parseStat } from '@plan/lib/count'
import { barValueWidth } from '@plan/lib/looks'
import { tidyDecimals } from '@plan/lib/stat-format'
import { typeset } from '@plan/lib/typeset'
import { clip, fit, fitBlock, riseLines, rrect, text } from '../engine/draw'
import { COL, eb, eo, mix, pr, prop } from '../engine/kit'
import { fallback } from './core'
import { fitInto, page, zone } from './page'
import { TONE_DIM } from './parts'
import type { DrawArgs, Screen } from './types'

const BAR_COLORS = [COL.lime, COL.bone, '#8c8c95', '#5a5a62']

type Bar = { label: string; value: string }

/**
 * Two (or more) numbers of one comparison: each bar names whose number it is, the value sits outside
 * its bar so it always reads, and the bar of the number being said (`times`) is lit as it lands.
 */
export const BarRace: Screen = {
  draw(a) {
    const { c, t } = a
    const bars = prop<Bar[]>(a.shot.props, 'bars', [])
      .filter((b) => b && typeof b.value === 'string')
      .slice(0, 4)
      .map((b) => ({ label: typeset(String(b.label ?? '')), value: tidyDecimals(b.value) }))
    if (bars.length === 0) return fallback.draw(a)
    page(a)
    const z = zone(a)
    const title = typeset(prop<string>(a.shot.props, 'title', ''))
    const times = Array.isArray(a.shot.props.times) ? (a.shot.props.times as number[]) : null
    const lay = a.memo('lay', () => {
      const stats = bars.map((b) => parseStat(b.value))
      const max = Math.max(...stats.map((s) => s?.value ?? 0), 1)
      const same = new Set(stats.map((s) => s?.suffix.trim())).size === 1
      const valueW = barValueWidth(bars.map((b) => b.value))
      const track = z.w - valueW - 24
      const titleLay = title
        ? fitBlock(title.toUpperCase(), 'monoB', z.w, 130, {
            max: 40,
            min: 26,
            lh: 1.2,
            ls: 0.04,
            maxLines: 2,
          })
        : null
      const h =
        (titleLay ? titleLay.lines.length * titleLay.size * 1.2 + 54 : 0) +
        bars.length * (66 + 16 + 92) +
        (bars.length - 1) * 54
      return { stats, max, same, valueW, track, titleLay, h }
    })
    fitInto(
      c,
      { ...z, h: z.h - 50 },
      z.w,
      lay.h,
      () => {
        let y = 0
        if (lay.titleLay) {
          riseLines(c, lay.titleLay.lines, 0, y, 'monoB', lay.titleLay.size, TONE_DIM, t, 0, {
            ls: 0.04,
            lh: 1.2,
            step: 0.03,
          })
          y += lay.titleLay.lines.length * lay.titleLay.size * 1.2 + 54
        }
        bars.forEach((b, i) => {
          drawBar(a, b, i, lay, times?.[i], y)
          y += 66 + 16 + 92 + 54
        })
      },
      true,
    )
  },
}

type BarLay = {
  stats: ReturnType<typeof parseStat>[]
  max: number
  same: boolean
  valueW: number
  track: number
}

function drawBar(
  a: DrawArgs,
  b: Bar,
  i: number,
  lay: BarLay,
  said: number | undefined,
  y: number,
): void {
  const { c, t } = a
  const grow = eo(pr(t, i * 0.08, 0.35))
  const color = BAR_COLORS[i] ?? COL.dim
  const lit = said !== undefined && said > 0.08 ? Math.sin(Math.PI * pr(t, said, 0.7)) : 0
  const v = lay.stats[i]?.value ?? 0
  const frac = lay.same ? Math.max(0.06, v / lay.max) : 1
  const p = eo(pr(t, i * 0.08, 0.4))
  c.save()
  c.globalAlpha = Math.min(1, p * 1.5)
  const label = clip(b.label, 'bold', 52, lay.track + lay.valueW)
  text(c, label, 0, y + 50, 'bold', 52, COL.white, { ls: -0.02 })
  const by = y + 66 + 16
  rrect(c, 0, by, lay.track, 92, 20)
  c.fillStyle = 'rgba(246,244,238,0.07)'
  c.fill()
  c.save()
  rrect(c, 0, by, lay.track, 92, 20)
  c.clip()
  c.fillStyle = color
  c.fillRect(0, by, lay.track * frac * mix(0.15, 1, grow), 92)
  if (lit > 0) {
    c.fillStyle = `rgba(255,255,255,${0.28 * lit})`
    c.fillRect(0, by, lay.track * frac * mix(0.15, 1, grow), 92)
  }
  c.restore()
  const vs = fit(b.value, 'display', lay.valueW, 84, 40, -0.04)
  const pulse = 1 + 0.06 * lit
  c.translate(lay.track + 24, by + 46)
  c.scale(pulse, pulse)
  text(c, b.value, 0, vs * 0.34, 'display', vs, color, { ls: -0.04 })
  c.restore()
}

/** Two sides of a before/after or this/that: the first muted, the second in lime, a VS stamp between. */
export const Compare: Screen = {
  draw(a) {
    const { c, t } = a
    page(a)
    const z = zone(a)
    const left = typeset(prop<string>(a.shot.props, 'left', 'Before'))
    const right = typeset(prop<string>(a.shot.props, 'right', 'After'))
    const cardH = Math.min(520, (z.h - 120) / 2)
    const lay = a.memo('lay', () => {
      const f = (s: string) =>
        fitBlock(s, 'display', z.w - 96, cardH - 120, {
          max: 130,
          min: 48,
          lh: 1.04,
          ls: -0.04,
          maxLines: 4,
        })
      return { l: f(left), r: f(right) }
    })
    const gap = 0
    const top = z.y + (z.h - cardH * 2 - gap) / 2 - 20
    side(
      a,
      lay.l,
      0,
      top,
      z.x,
      z.w,
      cardH,
      'rgba(246,244,238,0.08)',
      COL.white,
      'rgba(246,244,238,0.14)',
    )
    side(a, lay.r, 0.12, top + cardH + gap, z.x, z.w, cardH, COL.lime, COL.limeInk, null)
    const s = eb(pr(t, 0.3, 0.45), 1.8)
    if (s > 0) {
      c.save()
      c.translate(z.x + z.w / 2, top + cardH)
      c.rotate(((1 - Math.min(1, s)) * -40 * Math.PI) / 180)
      c.scale(s, s)
      c.beginPath()
      c.arc(0, 0, 65, 0, Math.PI * 2)
      c.fillStyle = COL.ink
      c.fill()
      c.beginPath()
      c.arc(0, 0, 57, 0, Math.PI * 2)
      c.fillStyle = COL.white
      c.fill()
      text(c, 'VS', 0, 20, 'display', 54, COL.ink, { align: 'center' })
      c.restore()
    }
  },
}

function side(
  a: DrawArgs,
  lay: { size: number; lines: string[] },
  t0: number,
  y: number,
  x: number,
  w: number,
  h: number,
  fill: string,
  ink: string,
  stroke: string | null,
): void {
  const { c, t } = a
  const p = eo(pr(t, t0, 0.5))
  c.save()
  c.globalAlpha = Math.min(1, p * 1.4)
  c.translate(0, (1 - p) * 50)
  rrect(c, x, y, w, h, 40)
  c.fillStyle = fill
  c.fill()
  if (stroke) {
    rrect(c, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 40)
    c.strokeStyle = stroke
    c.lineWidth = 1.5
    c.stroke()
  }
  c.restore()
  const bh = lay.lines.length * lay.size * 1.04
  riseLines(c, lay.lines, x + 48, y + (h - bh) / 2 + 4, 'display', lay.size, ink, t, t0 + 0.1, {
    lh: 1.04,
    ls: -0.04,
    step: 0.05,
  })
}
