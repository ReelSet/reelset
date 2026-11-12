import { keyPhraseIn } from '@plan/lib/extract'
import { typeset } from '@plan/lib/typeset'
import { chip } from '../chrome/marks'
import { card, fitBlock, riseLines } from '../engine/draw'
import { COL, ZONE_BOTTOM, eo, pr, prop } from '../engine/kit'
import { page, zone } from './page'
import { drawPhoto, imageOf, markerSweep, phraseWords, softFill } from './parts'
import type { Screen } from './types'

const IMG_H = 420
const IMG_H_UNDER_HEADLINE = 220

/** News headline: the lead image in a card, the source chip, the headline with its key phrase marked. */
export const ArticleHeadline: Screen = {
  draw(a) {
    const { c, t, ctx, shot } = a
    page(a, { backdrop: 0.4 })
    const z = zone(a)
    const hit = imageOf(a)
    if (hit)
      c.drawImage(
        a.memo(`soft:${hit.i}`, () => softFill(hit.img, 0.84)),
        0,
        0,
      )
    const site = ctx.facts.article?.site ?? ctx.domain
    const title = typeset(ctx.title)
    const phrase = prop<string>(shot.props, 'phrase', '') || keyPhraseIn(title, 2, 3) || ''
    const imgH = hit ? (shot.topPad > 0 ? IMG_H_UNDER_HEADLINE : IMG_H) : 0
    const textTop = z.y + (hit ? imgH + 40 : 0)
    const room = ZONE_BOTTOM - textTop - 120
    const lay = a.memo('lay', () =>
      fitBlock(title, 'display', z.w, Math.max(120, room), {
        max: hit ? 84 : 112,
        min: 40,
        lh: 1.04,
        ls: -0.035,
        maxLines: 8,
      }),
    )
    const blockH = 100 + lay.lines.length * lay.size * 1.04
    const top = hit ? textTop : z.y + Math.max(0, (z.h - blockH) / 2 - 30)
    if (hit) {
      const p = eo(pr(t, 0, 0.55))
      c.save()
      c.globalAlpha = Math.min(1, p * 1.4)
      c.translate(0, (1 - p) * 40)
      card(c, z.x, z.y, z.w, imgH, { r: 24, fill: COL.ink2, stroke: null })
      drawPhoto(
        a,
        hit.img,
        { x: z.x, y: z.y, w: z.w, h: imgH },
        { key: `art${hit.i}`, focus: hit.meta.focus, zoom: 1.1, backdrop: true, r: 24, maxUp: 2 },
      )
      c.restore()
    }
    const cp = eo(pr(t, 0.08, 0.45))
    c.save()
    c.globalAlpha = cp
    chip(c, ctx.source, site, z.x, top + (1 - cp) * 14, 1.6)
    c.restore()
    const base = top + 100
    const words = lay.lines.join(' ').split(' ')
    markerSweep(
      c,
      lay.lines,
      phraseWords(words, phrase),
      z.x,
      base,
      'display',
      lay.size,
      1.04,
      eo(pr(t, 0.6, 0.6)),
      -0.035,
    )
    riseLines(c, lay.lines, z.x, base, 'display', lay.size, COL.white, t, 0.12, {
      lh: 1.04,
      ls: -0.035,
      step: 0.05,
    })
  },
}
