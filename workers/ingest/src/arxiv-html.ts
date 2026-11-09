import { stripHtml } from './html'

const TAIL =
  /<(?:section|div|footer)\b[^>]*(?:ltx_bibliography|ltx_appendix|ltx_page_footer)|<footer\b/i

export type PaperSections = { intro: string | null; conclusion: string | null }

function plainSection(html: string): string {
  const withMath = html
    .replace(/<math\b[^>]*?alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, ' $1 ')
    .replace(/<(figure|table|cite|sup|annotation)\b[\s\S]*?<\/\1>/gi, ' ')
  return stripHtml(withMath)
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n(?!\n)/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** Intro and conclusion text from an arxiv.org/html (LaTeXML) page. */
export function extractPaperSections(html: string): PaperSections {
  const starts = [...html.matchAll(/<section\b[^>]*class="[^"]*\bltx_section\b[^"]*"[^>]*>/gi)]
  const sections = starts.map((m, i) => {
    const from = (m.index ?? 0) + m[0].length
    const to = starts[i + 1]?.index ?? html.length
    const body = html.slice(from, to).split(TAIL)[0] ?? ''
    const title = /<h2\b[^>]*ltx_title_section[^>]*>([\s\S]*?)<\/h2>/i.exec(body)?.[1] ?? ''
    return {
      title: plainSection(title)
        .replace(/^(?:\d+(?:\.\d+)*|[IVX]+)[.\s]\s*/, '')
        .toLowerCase(),
      body,
    }
  })
  const text = (re: RegExp) => {
    const section = sections.find((s) => re.test(s.title))
    if (!section) return null
    const t = plainSection(section.body.replace(/<h2\b[\s\S]*?<\/h2>/i, ''))
    return t || null
  }
  return {
    intro: text(/^introduction|^background and introduction/),
    conclusion: text(/conclusion|concluding|discussion|summary/),
  }
}

const MD_HEADING = /^#{1,4}\s+(?:\*\*)?(?:\d+(?:\.\d+)*[.\s]+)?([^\n*]+?)(?:\*\*)?\s*$/gm

/** Evidence texts from a PDF's markdown (Firecrawl fallback): method, results and conclusion bodies. */
export function pdfMarkdownEvidence(markdown: string, maxChars = 9000): string[] {
  const heads = [...markdown.matchAll(MD_HEADING)]
  const body = (i: number) =>
    markdown
      .slice((heads[i]!.index ?? 0) + heads[i]![0].length, heads[i + 1]?.index ?? markdown.length)
      .replace(/\s+/g, ' ')
      .trim()
  const pick = (label: string, re: RegExp, chars: number) => {
    const i = heads.findIndex((h) => re.test((h[1] ?? '').toLowerCase()))
    const text = i >= 0 ? body(i) : ''
    return text.length > 200 ? `${label}: ${text.slice(0, chars)}` : null
  }
  const out = [
    pick('Introduction', /^introduction/, 3000),
    pick('Method', /method|approach|model|architecture/, 3000),
    pick('Experiments and results', /experiment|result|evaluation/, 3000),
    pick('Conclusion', /conclusion|discussion|summary/, 1500),
  ].filter((t): t is string => t !== null)
  let used = 0
  return out.filter((t) => (used += t.length) <= maxChars)
}
