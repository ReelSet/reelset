import { sentencesUpTo } from '@plan/lib/text'
import { typeset } from '@plan/lib/typeset'
import { card, fitBlock, icon, measure, riseLines, rrect, text, type Ctx } from '../engine/draw'
import { COL, ZONE_BOTTOM, eo, pr, prop } from '../engine/kit'
import { fallback } from './core'
import { fitInto, page, zone } from './page'
import { HAIR, TONE_DIM, countLine, imageOf, paintSoft, pill, quoteCard } from './parts'
import { coverDraw } from './page'
import type { DrawArgs, Screen } from './types'
import { createCanvas, type Canvas } from '@napi-rs/canvas'

type Lay = { size: number; lines: string[] }

/** Whole sentences of a quote that fit `w` x `h` at a readable size. */
function quoteLayout(quote: string, w: number, h: number): { body: string; lay: Lay } {
  let body = sentencesUpTo(quote, 240)
  let lay = fitBlock(body, 'bold', w, h, { max: 64, min: 40, lh: 1.2, maxLines: 10 })
  for (let n = 220; n >= 60 && lay.lines.length * lay.size * 1.2 > h; n -= 20) {
    body = sentencesUpTo(quote, n)
    lay = fitBlock(body, 'bold', w, h, { max: 64, min: 40, lh: 1.2, maxLines: 10 })
  }
  return { body, lay }
}

const arrowUp = (c: Ctx, x: number, y: number, s: number, color: string) => {
  c.beginPath()
  c.moveTo(x + s / 2, y)
  c.lineTo(x + s, y + s * 0.85)
  c.lineTo(x, y + s * 0.85)
  c.closePath()
  c.fillStyle = color
  c.fill()
}

const rise = (p: number, d = 40) => [Math.min(1, eo(p) * 1.4), (1 - eo(p)) * d] as const

/* -------------------------------- HNThread -------------------------------- */

const HN_HEAD = 100

type HnLay = {
  variant: 'title' | 'comment' | 'stats'
  title: Lay
  quote: { body: string; lay: Lay } | null
  by: string
  h: number
}

function layoutHn(a: DrawArgs): HnLay {
  const z = zone(a)
  const hn = a.ctx.facts.hn
  const props = a.shot.props
  const comment = prop<string>(props, 'quote', hn?.topComment ?? '')
  const by = prop<string>(props, 'by', '') || (hn?.topComment ? 'top comment' : a.ctx.domain)
  let variant = prop<string>(props, 'variant', 'title') as HnLay['variant']
  if (variant === 'comment' && !comment) variant = 'title'
  if (variant === 'stats' && hn?.points === undefined && hn?.comments === undefined)
    variant = 'title'
  const title = fitBlock(typeset(a.ctx.title), 'bold', z.w - 140, 520, {
    max: 76,
    min: 44,
    lh: 1.12,
    ls: -0.02,
    maxLines: 7,
  })
  const quote =
    variant === 'comment' ? quoteLayout(comment, z.w - 88 - 80, z.h - HN_HEAD - 300) : null
  const inner =
    variant === 'comment' && quote
      ? 120 + quote.lay.lines.length * quote.lay.size * 1.2 + 86
      : variant === 'stats'
        ? 120 +
          70 +
          ((hn?.points !== undefined ? 1 : 0) + (hn?.comments !== undefined ? 1 : 0)) * 220 +
          (hn?.author ? 70 : 0)
        : title.lines.length * title.size * 1.12 + 150
  return { variant, title, quote, by, h: Math.min(z.h, HN_HEAD + 44 + inner + 44) }
}

export const HNThread: Screen = {
  draw(a) {
    const { c, t } = a
    page(a)
    const z = zone(a)
    const lay = a.memo('lay', () => layoutHn(a))
    const top = z.y + Math.max(0, (z.h - lay.h) * 0.3)
    const [al, dy] = rise(pr(t, 0, 0.5), 44)
    c.save()
    c.globalAlpha = al
    c.translate(0, dy)
    card(c, z.x, top, z.w, lay.h, { r: 28, fill: COL.ink2 })
    c.save()
    rrect(c, z.x, top, z.w, lay.h, 28)
    c.clip()
    c.fillStyle = COL.hn
    c.fillRect(z.x, top, z.w, HN_HEAD)
    c.restore()
    c.strokeStyle = '#fff'
    c.lineWidth = 4
    c.strokeRect(z.x + 36, top + 24, 52, 52)
    text(c, 'Y', z.x + 62, top + 63, 'display', 40, '#fff', { align: 'center' })
    text(c, 'Hacker News', z.x + 112, top + 64, 'bold', 42, '#111')
    c.restore()
    const body = { x: z.x + 40, y: top + HN_HEAD + 44, w: z.w - 80 }
    drawHnBody(a, lay, body)
  },
}

function drawHnBody(a: DrawArgs, lay: HnLay, b: { x: number; y: number; w: number }): void {
  const { c, t } = a
  const hn = a.ctx.facts.hn
  if (lay.variant === 'comment' && lay.quote) {
    quoteCard(
      c,
      lay.quote.body,
      lay.by,
      COL.hn,
      { x: b.x, y: b.y - 20, w: b.w, h: 9999 },
      t,
      0.1,
      lay.quote.lay,
      true,
    )
    return
  }
  if (lay.variant === 'stats') {
    riseLines(
      c,
      [lay.title.lines.slice(0, 2).join(' ').slice(0, 90)],
      b.x,
      b.y,
      'bold',
      34,
      TONE_DIM,
      t,
      0.05,
      { step: 0.02 },
    )
    let y = b.y + 150
    if (hn?.points !== undefined) {
      countLine(c, hn.points, 'points', COL.hn, b.x, y, b.w, t, 0.1)
      y += 220
    }
    if (hn?.comments !== undefined) {
      countLine(c, hn.comments, 'comments', COL.white, b.x, y, b.w, t, 0.22)
      y += 220
    }
    if (hn?.author) text(c, `posted by ${hn.author}`, b.x, y - 90, 'mono', 32, TONE_DIM)
    return
  }
  arrowUp(c, b.x, b.y + 8, 40, COL.hn)
  riseLines(c, lay.title.lines, b.x + 76, b.y, 'bold', lay.title.size, COL.white, t, 0.08, {
    lh: 1.12,
    ls: -0.02,
    step: 0.05,
  })
  const meta = b.y + lay.title.lines.length * lay.title.size * 1.12 + 40
  const p = eo(pr(t, 0.4, 0.5))
  c.save()
  c.globalAlpha = p
  c.fillStyle = HAIR
  c.fillRect(b.x, meta - 22, b.w, 1.5)
  text(c, a.ctx.domain, b.x, meta + 30, 'mono', 32, TONE_DIM)
  if (hn?.author) text(c, `by ${hn.author}`, b.x, meta + 80, 'mono', 30, 'rgba(246,244,238,0.4)')
  c.restore()
}

/* ------------------------------- RedditPost ------------------------------- */

type RedditLay = {
  variant: 'title' | 'comment' | 'stats'
  title: Lay
  small: Lay
  quote: { body: string; lay: Lay } | null
  by: string
  h: number
}

const SUB_H = 96

function layoutReddit(a: DrawArgs): RedditLay {
  const z = zone(a)
  const rd = a.ctx.facts.reddit
  const props = a.shot.props
  const quoteText = prop<string>(props, 'quote', rd?.topComment ?? rd?.text ?? '')
  const by = prop<string>(props, 'by', '') || (rd?.author ? `u/${rd.author}` : 'post')
  let variant = prop<string>(props, 'variant', 'title') as RedditLay['variant']
  if (variant === 'comment' && !quoteText) variant = 'title'
  if (variant === 'stats' && rd?.upvotes === undefined && rd?.comments === undefined)
    variant = 'title'
  const title = fitBlock(typeset(a.ctx.title), 'display', z.w - 88, 520, {
    max: 80,
    min: 46,
    lh: 1.08,
    ls: -0.03,
    maxLines: 7,
  })
  const small = fitBlock(typeset(a.ctx.title), 'bold', z.w, 100, {
    max: 36,
    min: 28,
    lh: 1.25,
    maxLines: 2,
  })
  const quote =
    variant === 'comment' ? quoteLayout(quoteText, z.w - 88 - 36, z.h - SUB_H - 100 - 330) : null
  const head = SUB_H + 40 + small.lines.length * small.size * 1.25 + 30
  const counts = (rd?.upvotes !== undefined ? 1 : 0) + (rd?.comments !== undefined ? 1 : 0)
  const body = quote ? 120 + quote.lay.lines.length * quote.lay.size * 1.2 + 86 : counts * 230
  return { variant, title, small, quote, by, h: head + body }
}

function subRow(a: DrawArgs, x: number, y: number, t: number): void {
  const { c } = a
  const rd = a.ctx.facts.reddit
  const p = eo(pr(t, 0, 0.45))
  c.save()
  c.globalAlpha = p
  c.beginPath()
  c.arc(x + 34, y + 34, 34, 0, Math.PI * 2)
  c.fillStyle = COL.reddit
  c.fill()
  text(c, 'r/', x + 34, y + 47, 'bold', 32, '#fff', { align: 'center' })
  const sub = rd?.subreddit ? `r/${rd.subreddit}` : a.ctx.domain
  const w = measure(sub, 'bold', 38)
  text(c, sub, x + 86, y + 47, 'bold', 38, COL.white)
  if (rd?.author) text(c, `u/${rd.author}`, x + 86 + w + 24, y + 46, 'mono', 28, TONE_DIM)
  c.restore()
}

export const RedditPost: Screen = {
  draw(a) {
    const { c, t } = a
    page(a)
    const z = zone(a)
    const lay = a.memo('lay', () => layoutReddit(a))
    const rd = a.ctx.facts.reddit
    const top0 = z.y + Math.max(0, (z.h - lay.h) * 0.3)
    if (lay.variant === 'comment' && lay.quote) {
      subRow(a, z.x, top0 + 10, t)
      riseLines(
        c,
        lay.small.lines,
        z.x,
        top0 + SUB_H + 24,
        'bold',
        lay.small.size,
        TONE_DIM,
        t,
        0.12,
        { lh: 1.25, step: 0.02 },
      )
      const qy = top0 + SUB_H + 40 + lay.small.lines.length * lay.small.size * 1.25 + 30
      quoteCard(
        c,
        lay.quote.body,
        lay.by,
        COL.reddit,
        { x: z.x, y: qy, w: z.w, h: ZONE_BOTTOM - qy },
        t,
        0.2,
        lay.quote.lay,
      )
      return
    }
    if (lay.variant === 'stats') {
      subRow(a, z.x, top0 + 10, t)
      riseLines(
        c,
        lay.small.lines,
        z.x,
        top0 + SUB_H + 24,
        'bold',
        lay.small.size,
        TONE_DIM,
        t,
        0.12,
        { lh: 1.25, step: 0.02 },
      )
      let y = top0 + SUB_H + 40 + lay.small.lines.length * lay.small.size * 1.25 + 230
      if (rd?.upvotes !== undefined) {
        countLine(c, rd.upvotes, 'upvotes', COL.reddit, z.x, y, z.w, t, 0.15)
        y += 230
      }
      if (rd?.comments !== undefined)
        countLine(c, rd.comments, 'comments', COL.white, z.x, y, z.w, t, 0.28)
      return
    }
    const innerH = SUB_H + 44 + lay.title.lines.length * lay.title.size * 1.08 + 44 + 70
    const h = innerH + 88
    const top = z.y + Math.max(0, (z.h - h) * 0.3)
    const [al, dy] = rise(pr(t, 0, 0.5), 44)
    c.save()
    c.globalAlpha = al
    c.translate(0, dy)
    card(c, z.x, top, z.w, h, { r: 36, fill: COL.ink2 })
    c.restore()
    subRow(a, z.x + 44, top + 44, t)
    riseLines(
      c,
      lay.title.lines,
      z.x + 44,
      top + 44 + SUB_H + 30,
      'display',
      lay.title.size,
      COL.white,
      t,
      0.1,
      {
        lh: 1.08,
        ls: -0.03,
        step: 0.05,
      },
    )
    const by = top + 44 + SUB_H + 30 + lay.title.lines.length * lay.title.size * 1.08 + 44
    const p = eo(pr(t, 0.45, 0.5))
    c.save()
    c.globalAlpha = p
    let x = z.x + 44
    x += pill(c, '▲  VOTE  ▼', x, by, 26, { fill: 'rgba(246,244,238,0.08)', fg: COL.white }) + 14
    c.restore()
    c.save()
    c.globalAlpha = p
    icon(c, 'message-square', x + 4, by + 6, 34, p, TONE_DIM, 2)
    text(c, 'Comments', x + 48, by + 33, 'monoB', 26, TONE_DIM, { ls: 0.04 })
    c.restore()
  },
}

/* ------------------------------ YouTubePlayer ------------------------------ */

let softSmall: Canvas | null = null

export const YouTubePlayer: Screen = {
  draw(a) {
    const { c, t, shot, ctx } = a
    const yt = ctx.facts.youtube
    page(a, { grid: false })
    const z = zone(a)
    const hit = imageOf(a)
    if (hit) {
      softSmall ??= createCanvas(54, 96)
      paintSoft(c, softSmall, hit.img, 0.72)
    }
    const pw = z.w
    const ph = Math.round((pw * 9) / 16)
    const shift = Math.max(0, (z.h - ph - 560) * 0.3)
    c.save()
    c.translate(0, shift)
    const [al, dy] = rise(pr(t, 0, 0.5), 44)
    c.save()
    c.globalAlpha = al
    c.translate(0, dy)
    c.save()
    rrect(c, z.x, z.y, pw, ph, 26)
    c.clip()
    c.fillStyle = '#000'
    c.fillRect(z.x, z.y, pw, ph)
    if (hit)
      coverDraw(c, hit.img, t, shot.dur, {
        zoom: 1.05,
        x: z.x,
        y: z.y,
        w: pw,
        h: ph,
        focus: hit.meta.focus,
      })
    else {
      const gr = c.createLinearGradient(z.x, z.y, z.x + pw, z.y + ph)
      gr.addColorStop(0, '#2a0a10')
      gr.addColorStop(1, '#0c0c10')
      c.fillStyle = gr
      c.fillRect(z.x, z.y, pw, ph)
    }
    c.fillStyle = 'rgba(11,11,14,0.28)'
    c.fillRect(z.x, z.y, pw, ph)
    c.beginPath()
    c.arc(z.x + pw / 2, z.y + ph / 2, 62, 0, Math.PI * 2)
    c.fillStyle = 'rgba(11,11,14,0.62)'
    c.fill()
    c.beginPath()
    c.moveTo(z.x + pw / 2 - 16, z.y + ph / 2 - 28)
    c.lineTo(z.x + pw / 2 + 32, z.y + ph / 2)
    c.lineTo(z.x + pw / 2 - 16, z.y + ph / 2 + 28)
    c.closePath()
    c.fillStyle = '#fff'
    c.fill()
    c.fillStyle = 'rgba(246,244,238,0.25)'
    c.fillRect(z.x, z.y + ph - 8, pw, 8)
    c.fillStyle = COL.youtube
    c.fillRect(z.x, z.y + ph - 8, pw * (0.08 + 0.26 * pr(t, 0, Math.max(1, shot.dur))), 8)
    c.restore()
    if (yt?.duration) {
      const w = measure(yt.duration, 'monoB', 26) + 28
      card(c, z.x + pw - w - 20, z.y + ph - 74, w, 46, {
        r: 12,
        fill: 'rgba(11,11,14,0.8)',
        stroke: null,
      })
      text(c, yt.duration, z.x + pw - w / 2 - 20, z.y + ph - 41, 'monoB', 26, COL.white, {
        align: 'center',
      })
    }
    c.restore()
    const title = a.memo('title', () =>
      fitBlock(typeset(ctx.title), 'bold', z.w, 220, {
        max: 60,
        min: 38,
        lh: 1.15,
        ls: -0.02,
        maxLines: 3,
      }),
    )
    const ty = z.y + ph + 40
    riseLines(c, title.lines, z.x, ty, 'bold', title.size, COL.white, t, 0.15, {
      lh: 1.15,
      ls: -0.02,
      step: 0.05,
    })
    const cy = ty + title.lines.length * title.size * 1.15 + 36
    const channel = yt?.channel ?? ctx.sourceLabel
    const p = eo(pr(t, 0.4, 0.5))
    c.save()
    c.globalAlpha = p
    c.beginPath()
    c.arc(z.x + 40, cy + 40, 40, 0, Math.PI * 2)
    c.fillStyle = COL.youtube
    c.fill()
    text(c, channel.slice(0, 1).toUpperCase(), z.x + 40, cy + 55, 'display', 40, '#fff', {
      align: 'center',
    })
    text(c, channel, z.x + 100, cy + 54, 'bold', 38, COL.white)
    c.restore()
    const hook = a.memo('hook', () =>
      fitBlock(typeset(ctx.hook), 'ui', z.w - 64, 150, { max: 34, min: 26, lh: 1.3, maxLines: 3 }),
    )
    const hy = cy + 110
    const room = ZONE_BOTTOM - hy
    const hh = hook.lines.length * hook.size * 1.3 + 52
    if (hook.lines.length && room >= hh) {
      c.save()
      c.globalAlpha = eo(pr(t, 0.55, 0.5))
      card(c, z.x, hy, z.w, hh, { r: 24, fill: COL.ink2 })
      c.restore()
      riseLines(
        c,
        hook.lines,
        z.x + 32,
        hy + 22,
        'ui',
        hook.size,
        'rgba(246,244,238,0.8)',
        t,
        0.6,
        { lh: 1.3, step: 0.02 },
      )
    }
    c.restore()
  },
}
