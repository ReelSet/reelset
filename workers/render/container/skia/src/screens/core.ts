import { accentIndex } from '@plan/lib/emphasis'
import { endName, endSubtitle } from '@plan/lib/endcard'
import { displayStat } from '@plan/lib/stat-format'
import { typeset } from '@plan/lib/typeset'
import { chip } from '../chrome/marks'
import { card, fit, fitBlock, measure, riseLines, rrect, text, type Ctx } from '../engine/draw'
import { COL, CONTENT_TOP, H, L, R, W, ZONE_BOTTOM, eb, eo, pr, prop } from '../engine/kit'
import type { Still } from '../engine/media'
import { coverDraw, page, zone } from './page'
import type { DrawArgs, Screen } from './types'

const imageOf = (a: DrawArgs, key = 'image'): { img: Still; i: number } | null => {
  const i = a.shot.props[key]
  if (typeof i !== 'number') return null
  const img = a.media.image(i)
  return img ? { img, i } : null
}

/** Contained photo card over a blurred, dimmed copy of itself, with a slow push-in. */
function photoCard(
  a: DrawArgs,
  img: Still,
  i: number,
  box: { x: number; y: number; w: number; h: number },
): void {
  const { c, t, shot } = a
  const focus = a.ctx.images[i]?.focus
  coverDraw(c, img, t, shot.dur, { zoom: 1.12, focus, alpha: 0.28 })
  c.fillStyle = 'rgba(11,11,14,0.55)'
  c.fillRect(0, 0, W, H)
  const k = Math.min(box.w / img.width, box.h / img.height)
  const w = img.width * k
  const h = img.height * k
  const x = box.x + (box.w - w) / 2
  const y = box.y + (box.h - h) / 2
  const p = eo(pr(t, 0, 0.55))
  const s = 0.94 + 0.06 * p + 0.03 * pr(t, 0, Math.max(1, shot.dur))
  c.save()
  c.globalAlpha = Math.min(1, p * 1.4)
  c.translate(x + w / 2, y + h / 2 + (1 - p) * 60)
  c.scale(s, s)
  c.shadowColor = 'rgba(0,0,0,0.55)'
  c.shadowBlur = 60
  c.shadowOffsetY = 24
  rrect(c, -w / 2, -h / 2, w, h, 26)
  c.fillStyle = COL.ink2
  c.fill()
  c.shadowColor = 'transparent'
  c.clip()
  c.drawImage(img as never, -w / 2, -h / 2, w, h)
  c.restore()
}

export const ImageFull: Screen = {
  draw(a) {
    const { c, t } = a
    const hit = imageOf(a)
    if (!hit) return fallback.draw(a)
    const z = zone(a)
    const im = a.ctx.images[hit.i]
    if (a.shot.props.bleed === true && im?.kind !== 'thumbnail') {
      coverDraw(c, hit.img, t, a.shot.dur, { zoom: 1.1, focus: im?.focus })
      const gr = c.createLinearGradient(0, 0, 0, H)
      gr.addColorStop(0, 'rgba(11,11,14,0.55)')
      gr.addColorStop(0.4, 'rgba(11,11,14,0.1)')
      gr.addColorStop(1, 'rgba(11,11,14,0.75)')
      c.fillStyle = gr
      c.fillRect(0, 0, W, H)
      return
    }
    c.fillStyle = COL.ink
    c.fillRect(0, 0, W, H)
    photoCard(a, hit.img, hit.i, { x: z.x, y: z.y + 20, w: z.w, h: z.h - 120 })
  },
}

/** A statement: words rise in, one accent word in lime, a sub line in mono under a short rule. */
function textPoint(a: DrawArgs): void {
  const { c, t, shot } = a
  page(a)
  const z = zone(a)
  const raw = typeset(
    String(shot.props.text ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  const sub = typeset(prop<string>(shot.props, 'sub', ''))
  const quote = typeset(prop<string>(shot.props, 'quote', ''))
  const by = prop<string>(shot.props, 'by', '')
  const main = raw || quote
  if (!main) return a.media.backdrop() ? brollMoment(a) : emptyPlate(a)
  const isQuote = !raw && !!quote
  const font = isQuote ? 'serif' : 'display'
  const subH = sub || by ? 150 : 0
  const lay = a.memo('lay', () =>
    fitBlock(isQuote ? `“${main}”` : main, font, z.w, z.h - subH - 60, {
      max: isQuote ? 96 : 150,
      min: 50,
      lh: isQuote ? 1.08 : 1.0,
      ls: isQuote ? 0 : -0.035,
      maxLines: 6,
    }),
  )
  const lh = isQuote ? 1.08 : 1.0
  const blockH = lay.lines.length * lay.size * lh + subH
  const top = z.y + Math.max(0, (z.h - blockH) / 2 - 40)
  const words = main.split(' ')
  const accent = isQuote ? -1 : accentIndex(words)
  let k = 0
  const flat: number[][] = lay.lines.map((l) => l.split(' ').map(() => k++))
  const end = riseLines(
    c,
    lay.lines,
    z.x,
    top,
    font,
    lay.size,
    (li, wi) => (flat[li]?.[wi] === accent ? COL.lime : COL.white),
    t,
    0.02,
    { lh, step: Math.min(0.06, 0.6 / Math.max(1, words.length)), ls: isQuote ? 0 : -0.035 },
  )
  const subTop = top + lay.lines.length * lay.size * lh + 40
  if (sub || by) {
    const p = eo(pr(t, Math.min(end, 0.7), 0.5))
    rrect(c, z.x, subTop, 70 * p, 6, 3)
    c.fillStyle = COL.lime
    c.fill()
    const line = sub || `— ${by}`
    const size = fit(line, 'mono', z.w, 36, 24)
    riseLines(
      c,
      [line],
      z.x,
      subTop + 30,
      'mono',
      size,
      'rgba(246,244,238,0.7)',
      t,
      Math.min(end, 0.7) + 0.1,
      { step: 0.03 },
    )
  }
}

/** A beat with no words of its own: the stock clip plays full-frame, the domain tagged at the top. */
function brollMoment(a: DrawArgs): void {
  const { c, t, shot, ctx } = a
  const bd = a.media.backdrop()
  c.fillStyle = COL.ink
  c.fillRect(0, 0, W, H)
  if (bd) coverDraw(c, bd, t, shot.dur, { zoom: 1.1, alpha: 0.92 })
  const z = zone(a)
  const p = eo(pr(t, 0.15, 0.5))
  const dom = ctx.domain.length > 40 ? `${ctx.domain.slice(0, 39)}…` : ctx.domain
  if (!dom) return
  const w = measure(dom, 'monoB', 30) + 70
  c.save()
  c.globalAlpha = p
  card(c, z.x, z.y + 10, w, 60, {
    r: 30,
    fill: 'rgba(11,11,14,0.72)',
    stroke: 'rgba(246,244,238,0.14)',
  })
  c.beginPath()
  c.arc(z.x + 30, z.y + 40, 7, 0, Math.PI * 2)
  c.fillStyle = COL.lime
  c.fill()
  text(c, dom, z.x + 50, z.y + 51, 'monoB', 30, COL.white)
  c.restore()
}

/** Nothing to say on screen: the item's own plate (source chip and title). */
function emptyPlate(a: DrawArgs): void {
  const { c, t, ctx } = a
  const z = zone(a)
  const title = ctx.title
  const lay = a.memo('plate', () =>
    fitBlock(title, 'display', z.w, 420, { max: 96, min: 48, lh: 1.02, ls: -0.03, maxLines: 4 }),
  )
  const top = z.y + (z.h - lay.lines.length * lay.size * 1.02) / 2 - 60
  const p = eo(pr(t, 0, 0.5))
  c.save()
  c.globalAlpha = p
  chip(c, ctx.source, ctx.sourceLabel, z.x, top - 110, 1.7)
  c.restore()
  riseLines(c, lay.lines, z.x, top, 'display', lay.size, COL.white, t, 0.1, { lh: 1.02, ls: -0.03 })
}

function hookHeadline(a: DrawArgs): void {
  const { c, t, shot } = a
  c.fillStyle = COL.ink
  c.fillRect(0, 0, W, H)
  const bi = shot.props.bgImage
  const img = typeof bi === 'number' ? a.media.image(bi) : null
  if (img)
    coverDraw(c, img, t, shot.dur, {
      zoom: 1.1,
      focus: a.ctx.images[bi as number]?.focus,
      alpha: 0.55,
    })
  else if (a.media.backdrop()) page(a, { grid: false })
  const gr = c.createLinearGradient(0, 0, 0, H)
  gr.addColorStop(0, 'rgba(11,11,14,0.6)')
  gr.addColorStop(0.45, 'rgba(11,11,14,0.25)')
  gr.addColorStop(1, 'rgba(11,11,14,0.75)')
  c.fillStyle = gr
  c.fillRect(0, 0, W, H)
  const label = typeset(prop<string>(shot.props, 'text', '')).toUpperCase()
  const words = label.split(' ')
  const accent = accentIndex(words)
  const lay = a.memo('hook', () =>
    fitBlock(label, 'display', R - L, ZONE_BOTTOM - CONTENT_TOP - 80, {
      max: 200,
      min: 70,
      lh: 0.96,
      ls: -0.04,
      maxLines: 6,
    }),
  )
  const top =
    CONTENT_TOP + (ZONE_BOTTOM - CONTENT_TOP - lay.lines.length * lay.size * 0.96) / 2 - 40
  let k = 0
  const flat = lay.lines.map((l) => l.split(' ').map(() => k++))
  riseLines(
    c,
    lay.lines,
    L,
    top,
    'display',
    lay.size,
    (li, wi) => (flat[li]?.[wi] === accent ? COL.lime : COL.white),
    t,
    0.02,
    {
      lh: 0.96,
      step: 0.07,
      ls: -0.04,
    },
  )
}

/** Items said one by one: a numbered list, the current item lit, earlier ones dimmed with a check. */
function listCard(a: DrawArgs): void {
  const { c, t, shot } = a
  page(a)
  const z = zone(a)
  const items = (shot.props.items as unknown[]).map((i) => typeset(String(i)))
  const times = Array.isArray(shot.props.times)
    ? (shot.props.times as number[])
    : items.map((_, i) => i * 0.6)
  const kicker = typeset(prop<string>(shot.props, 'kicker', ''))
  const said = times.filter((x) => x <= t + 0.05).length
  const current = Math.max(0, said - 1)
  const kh = kicker ? 110 : 0
  const rowGap = 34
  const size = a.memo('size', () => {
    let s = 76
    while (s > 40) {
      const h = items.reduce(
        (acc, it) =>
          acc +
          fitBlock(it, 'bold', z.w - 120, 999, { max: s, min: s, lh: 1.08, maxLines: 3 }).lines
            .length *
            s *
            1.08 +
          rowGap,
        0,
      )
      if (h <= z.h - kh - 40) break
      s -= 4
    }
    return s
  })
  let y = z.y + 20
  if (kicker) {
    const ks = fit(kicker.toUpperCase(), 'monoB', z.w, 34, 24)
    riseLines(c, [kicker.toUpperCase()], z.x, y, 'monoB', ks, COL.lime, t, 0, {
      step: 0.03,
      ls: 0.08,
    })
    y += kh
  }
  items.forEach((it, i) => {
    const t0 = times[i] ?? i * 0.6
    const lines = fitBlock(it, 'bold', z.w - 120, 999, {
      max: size,
      min: size,
      lh: 1.08,
      maxLines: 3,
    }).lines
    const p = eo(pr(t, t0 - 0.05, 0.45))
    if (p <= 0) {
      y += lines.length * size * 1.08 + rowGap
      return
    }
    const lit = i === current
    const done = i < current
    c.save()
    c.globalAlpha = p * (done ? 0.45 : 1)
    const n = String(i + 1).padStart(2, '0')
    const bump = lit ? eb(pr(t, t0, 0.35), 2) : 1
    c.translate(z.x + 36, y + size * 0.55)
    c.scale(bump, bump)
    rrect(c, -36, -36, 72, 72, 18)
    c.fillStyle = lit ? COL.lime : 'rgba(246,244,238,0.08)'
    c.fill()
    text(c, n, 0, 12, 'monoB', 30, lit ? COL.limeInk : COL.white, { align: 'center' })
    c.restore()
    c.save()
    c.globalAlpha = done ? 0.45 : 1
    riseLines(
      c,
      lines,
      z.x + 110,
      y,
      'bold',
      size,
      lit ? COL.white : 'rgba(246,244,238,0.85)',
      t,
      t0 - 0.05,
      { lh: 1.08, step: 0.03 },
    )
    c.restore()
    y += lines.length * size * 1.08 + rowGap
  })
}

export const KeyPoint: Screen = {
  draw(a) {
    if (a.shot.props.hook === true) return hookHeadline(a)
    if (Array.isArray(a.shot.props.items) && a.shot.props.items.length > 0) return listCard(a)
    return textPoint(a)
  },
}

/** A said number slams in (back-out scale), its label rises under it, a lime bar draws on. */
export const StatSlam: Screen = {
  draw(a) {
    const { c, t, shot } = a
    page(a)
    const z = zone(a)
    const raw = prop<string>(shot.props, 'value', '')
    const label = typeset(prop<string>(shot.props, 'label', ''))
    const shown = displayStat(raw, label) || raw
    if (!shown) return textPoint(a)
    const size = a.memo('size', () => fit(shown, 'display', z.w, 300, 110, -0.04))
    const lab = a.memo('lab', () =>
      fitBlock(label, 'bold', z.w, 220, { max: 64, min: 36, lh: 1.08, maxLines: 3 }),
    )
    const blockH = size * 0.9 + 60 + lab.lines.length * lab.size * 1.08
    const top = z.y + (z.h - blockH) / 2 - 30
    const base = top + size * 0.86
    const s = eb(pr(t, 0, 0.42), 1.9)
    const w = measure(shown, 'display', size, -0.04)
    for (let i = 0; i < 2; i++) {
      const q = pr(t, 0.12 + i * 0.12, 0.9)
      if (q <= 0 || q >= 1) continue
      c.save()
      c.strokeStyle = `rgba(200,247,81,${0.45 * (1 - q)})`
      c.lineWidth = 4
      c.beginPath()
      c.arc(z.x + w / 2, base - size * 0.35, 120 + eo(q) * 520, 0, Math.PI * 2)
      c.stroke()
      c.restore()
    }
    c.save()
    c.translate(z.x + w / 2, base - size * 0.35)
    c.scale(s, s)
    c.globalAlpha = Math.min(1, pr(t, 0, 0.1) * 1.2)
    text(c, shown, -w / 2, size * 0.35, 'display', size, COL.lime, { ls: -0.04 })
    c.restore()
    const bar = eo(pr(t, 0.3, 0.5))
    rrect(c, z.x, base + 34, Math.min(w, 360) * bar, 10, 5)
    c.fillStyle = COL.white
    c.fill()
    riseLines(c, lab.lines, z.x, base + 74, 'bold', lab.size, COL.white, t, 0.32, {
      lh: 1.08,
      step: 0.04,
    })
  },
}

/** Outro: the item name big, its subtitle, source chip, and a follow pill. */
export const EndCard: Screen = {
  captions: () => true,
  draw(a) {
    const { c, t, ctx } = a
    page(a)
    const z = zone(a)
    const name = typeset(endName(ctx))
    const sub = typeset(endSubtitle(ctx))
    const lay = a.memo('name', () =>
      fitBlock(name, 'display', z.w, 360, { max: 130, min: 56, lh: 1.0, ls: -0.035, maxLines: 3 }),
    )
    const subLay = a.memo('sub', () =>
      sub ? fitBlock(sub, 'bold', z.w, 160, { max: 48, min: 30, lh: 1.15, maxLines: 3 }) : null,
    )
    const blockH =
      120 +
      lay.lines.length * lay.size +
      (subLay ? subLay.lines.length * subLay.size * 1.15 + 40 : 0) +
      160
    let y = z.y + (z.h - blockH) / 2
    const p = eo(pr(t, 0, 0.5))
    c.save()
    c.globalAlpha = p
    chip(c, ctx.source, ctx.sourceLabel, z.x, y, 1.9)
    c.restore()
    y += 120
    riseLines(c, lay.lines, z.x, y, 'display', lay.size, COL.white, t, 0.12, {
      lh: 1.0,
      ls: -0.035,
    })
    y += lay.lines.length * lay.size + 40
    if (subLay) {
      riseLines(c, subLay.lines, z.x, y, 'bold', subLay.size, 'rgba(246,244,238,0.7)', t, 0.4, {
        lh: 1.15,
        step: 0.03,
      })
      y += subLay.lines.length * subLay.size * 1.15 + 40
    }
    const q = eb(pr(t, 0.7, 0.4), 1.8)
    if (q > 0) {
      const label = 'Follow @reelset.app'
      const w = measure(label, 'bold', 40) + 80
      c.save()
      c.translate(z.x + w / 2, y + 45)
      c.scale(q, q)
      card(c, -w / 2, -45, w, 90, { r: 45, fill: COL.lime, stroke: null })
      text(c, label, 0, 14, 'bold', 40, COL.limeInk, { align: 'center' })
      c.restore()
    }
  },
}

/** Any screen not built yet (or one that threw): the item's title plate, so a reel never fails on a screen. */
export const fallback: Screen = {
  draw(a) {
    page(a)
    if (typeof a.shot.props.text === 'string' && a.shot.props.text.trim()) return textPoint(a)
    emptyPlate(a)
  },
}

export function drawSoftShadow(c: Ctx, x: number, y: number, w: number, h: number): void {
  card(c, x, y, w, h, { shadow: 0.5, stroke: null })
}
