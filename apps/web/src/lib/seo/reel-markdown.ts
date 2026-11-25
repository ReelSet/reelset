import { reelPath } from '@/lib/reel-url'
import { SITE_URL, absoluteUrl, hostOf } from '@/lib/seo/site'
import type { ReelPageData } from '@/lib/seo/types'

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const linkText = (text: string) => oneLine(text.replace(/[[\]]/g, ''))

/** The reel page as markdown for agents: same facts as the HTML page, no UI. */
export function reelMarkdown(reel: ReelPageData): string {
  const out: string[] = [`# ${oneLine(reel.title)}`, '']
  if (reel.tldr?.trim()) out.push(`> ${oneLine(reel.tldr)}`, '')

  out.push(
    `- Reel: ${absoluteUrl(reelPath(reel))}`,
    `- Original: ${reel.canonicalUrl}`,
    `- Published: ${reel.publishedAt.slice(0, 10)}`,
  )
  if (reel.topics.length) out.push(`- Topics: ${reel.topics.join(', ')}`)
  if (reel.videoUrl) out.push(`- Video: ${reel.videoUrl}`)
  out.push('')

  if (reel.facts.length) {
    out.push('## Key facts', '')
    for (const fact of reel.facts) {
      const sources = fact.sources.map((s) => `[${linkText(s.title)}](${s.url})`).join(', ')
      out.push(`- ${oneLine(fact.text)}${sources ? ` (${sources})` : ''}`)
    }
    out.push('')
  }

  if (reel.transcript?.trim()) out.push('## Transcript', '', reel.transcript.trim(), '')

  if (reel.mentions.length) {
    out.push('## Discussion', '')
    for (const m of reel.mentions) {
      const stats = [
        m.score === null ? '' : `, ${m.score} points`,
        m.comments === null ? '' : `, ${m.comments} comments`,
      ].join('')
      out.push(`- [${linkText(m.title ?? '') || hostOf(m.url)}](${m.url}) on ${m.source}${stats}`)
    }
    out.push('')
  }

  out.push(
    '---',
    '',
    `From [Reelset](${SITE_URL}). More developer stories: ${absoluteUrl('/llms.txt')}`,
    '',
  )
  return out.join('\n')
}
