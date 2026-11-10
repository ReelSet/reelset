import { isNumericCell, mainResultsTable, type PaperTable, type ParsedPaper } from '@reelset/core'

export type BriefComment = { author: string | null; score: number | null; text: string }

export type BriefMention = {
  source: string
  url: string
  title: string | null
  body: string | null
  author: string | null
  score: number | null
  numComments: number | null
  publishedAt: Date | string | null
  linkedUrl?: string | null
  facts: Record<string, unknown>
  extraTexts: readonly string[]
  externalId?: string
}

export type GithubExtras = {
  stars?: number | null
  forks?: number | null
  language?: string | null
  topics?: readonly string[]
  description?: string | null
  createdAt?: string | null
  release?: { tag: string; name: string | null; body: string | null; publishedAt: string | null }
  readme?: string | null
}

export type Supplements = {
  /** Fresh comments keyed by mention external id (HN Algolia items, Reddit .json). */
  comments?: Record<string, readonly BriefComment[]>
  github?: GithubExtras
}

export type BriefInput = {
  kind: string
  title: string
  canonicalKey: string
  canonicalUrl: string
  mentions: readonly BriefMention[]
  paper?: ParsedPaper | null
  hasDemo?: boolean
  supplements?: Supplements
}

export type SourceBrief = { text: string; facts: string }

const MAX_COMMENTS = 5
const COMMENT_CHARS = 280
const FEATURE_BULLETS = 6
const ARTICLE_COMMENT_LIMIT = 650

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

const day = (d: Date | string | null | undefined): string | null => {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

const fmt = (n: number | null | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : null

const row = (label: string, value: string | null | undefined): string | null =>
  value ? `${label}: ${value}` : null

const lines = (...parts: (string | null | undefined | false)[]): string[] =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0)

const sentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 320)

const QUANT =
  /\d[\d,.]*\s?(?:%|×|x\b|k\b|K\b|M\b|B\b|ms\b|s\b|GB\b|MB\b|min|hours?|days?|points?)|\b\d{2,}\b/

/** Sentences that carry a concrete number, best (most numbers and units) first. */
export function keyNumberSentences(text: string, max = 4): string[] {
  return sentences(text)
    .map((s, i) => ({ s, i, n: (s.match(new RegExp(QUANT, 'g')) ?? []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => clip(x.s, 240))
}

export function leadSentences(text: string, max = 2): string[] {
  return sentences(text)
    .slice(0, max)
    .map((s) => clip(s, 240))
}

function authorLine(paper: ParsedPaper): string {
  const names = paper.authors.slice(0, 3).join(', ')
  const more = paper.authors.length > 3 ? ` +${paper.authors.length - 3} more` : ''
  const aff = paper.affiliations
    .slice(0, 2)
    .map((a) => a.replace(/^Affiliation:\s*/i, ''))
    .join('; ')
  return `${names}${more}${aff ? ` (${aff})` : ''}`
}

const SIZE_CELL = /^\d+(?:\.\d+)?\s?[BMK]$/i

/** Columns of numbers; a column of model sizes ("4B", "1.7B") is a setting, not a metric. */
const numericCols = (t: PaperTable): number[] =>
  t.headers
    .map((_, c) => c)
    .filter((c) => {
      const cells = t.rows.map((r) => r[c] ?? '').filter((x) => x.trim() !== '')
      if (cells.length < 2) return false
      if (cells.every((x) => SIZE_CELL.test(x.trim()))) return false
      return cells.filter(isNumericCell).length / cells.length >= 0.5
    })

/**
 * Labelled rows of a results table. Leading text columns (setting, method) form the row label and
 * rows without numbers ("Qwen3-1.7B") become a section prefix, so rows from different model sizes
 * or settings never get mixed up.
 */
export function labelledRows(t: PaperTable, maxRows = 12): string[] {
  const numeric = numericCols(t)
  if (numeric.length === 0) return []
  const firstNumeric = numeric[0]!
  const blocks: { name: string; rows: string[] }[] = [{ name: '', rows: [] }]
  for (const cells of t.rows) {
    const label = cells
      .slice(0, firstNumeric)
      .map((c) => c.trim())
      .filter(Boolean)
      .join(' / ')
    const values = numeric
      .map((c) => ({ h: (t.headers[c] ?? '').trim(), v: (cells[c] ?? '').trim() }))
      .filter((x) => x.v !== '' && x.v !== '–' && x.v !== '-')
    if (values.length === 0) {
      if (label) blocks.push({ name: label, rows: [] })
      continue
    }
    const pairs = values.map((x) => (x.h ? `${clip(x.h, 24)}=${x.v}` : x.v)).join(', ')
    blocks[blocks.length - 1]!.rows.push(`${label || 'row'}: ${pairs}`)
  }
  const used = blocks.filter((b) => b.rows.length > 0)
  const perBlock = Math.max(3, Math.ceil(maxRows / Math.max(1, used.length)))
  const labelled = used.length > 1
  return used.flatMap((b, i) =>
    b.rows
      .slice(0, perBlock)
      .map(
        (r) =>
          `${labelled ? `[${b.name || (i === 0 ? 'first block' : `block ${i + 1}`)}] ` : ''}${r}`,
      ),
  )
}

const RESULT_CAPTION =
  /result|compar|perform|accuracy|recover|cost|speed|time|efficien|benchmark|score/i

export function paperResultTables(paper: ParsedPaper, max = 3): PaperTable[] {
  const main = mainResultsTable(paper)
  const rest = paper.tables.filter(
    (t) =>
      t !== main &&
      RESULT_CAPTION.test(`${t.label ?? ''} ${t.caption}`) &&
      numericCols(t).length > 0,
  )
  return [...(main ? [main] : []), ...rest].slice(0, max)
}

function paperBrief(input: BriefInput, paper: ParsedPaper): string[] {
  const abstractNumbers = keyNumberSentences(paper.abstract, 3)
  const claim = leadSentences(paper.abstract, 1)[0]
  const tables = paperResultTables(paper)
  const code = paper.links.find((l) => l.kind === 'code')?.url
  return lines(
    row('Paper', paper.title),
    row('Authors', authorLine(paper)),
    row('One-line claim (from abstract)', claim),
    abstractNumbers.length > 0 &&
      `Numbers stated in the abstract:\n${abstractNumbers.map((s) => `- ${s}`).join('\n')}`,
    ...tables.map((t) => {
      const rows = labelledRows(t)
      if (rows.length === 0) return null
      const head = `${t.label ?? 'Table'}: ${clip(t.caption, 200)}`
      return `KEY RESULTS ${head}${t.bestBy !== 'none' ? ' (best per column in bold in the paper)' : ''}\n${rows.map((r) => `- ${r}`).join('\n')}`
    }),
    paper.figures.length > 0 &&
      `Figures:\n${paper.figures
        .slice(0, 4)
        .map((f) => `- ${f.label ?? 'Figure'}: ${clip(f.caption, 140)}`)
        .join('\n')}`,
    row('Code', code),
  )
}

const INSTALL =
  /^\s*(?:\$\s*)?((?:npm|npx|pnpm|yarn|bun|pip3?|pipx|uv|cargo|brew|go|docker|curl|git clone|apt(?:-get)?|gem|dotnet|winget|conda|ollama)\s[^\n]{3,120})$/gm

export function installCommands(readme: string, max = 3): string[] {
  const found: string[] = []
  for (const m of readme.matchAll(INSTALL)) {
    const cmd = m[1]!.trim()
    if (!found.includes(cmd)) found.push(cmd)
    if (found.length >= max) break
  }
  return found
}

export function featureBullets(readme: string, max = FEATURE_BULLETS): string[] {
  const bullets: string[] = []
  let inFence = false
  for (const raw of readme.split('\n')) {
    if (/^\s*```/.test(raw)) inFence = !inFence
    if (inFence) continue
    const m = /^\s*[-*]\s+(?:\*\*)?([^\n]{12,200})/.exec(raw)
    if (!m) continue
    const text = clip(m[1]!.replace(/\*\*|`|\[([^\]]+)\]\([^)]*\)/g, '$1'), 150)
    if (/^(?:\[|!\[|https?:|license|contribut)/i.test(text)) continue
    bullets.push(text)
    if (bullets.length >= max) break
  }
  return bullets
}

/** Release notes as plain prose: no code fences, headings, emphasis or install boilerplate. */
export function plainNotes(body: string | null | undefined): string | null {
  if (!body) return null
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split('\n')
    .filter((l) => !/^\s*(?:install|download|checksums?|\|)/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length >= 20 ? text : null
}

function githubBrief(input: BriefInput): string[] {
  const m = input.mentions.find((x) => x.source === 'github')
  const extra = input.supplements?.github
  const f = m?.facts ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const readme = (extra?.readme ?? m?.extraTexts[0] ?? '').replace(/<[^>]+>/g, ' ')
  const topics = extra?.topics ?? (Array.isArray(f.topics) ? (f.topics as string[]) : [])
  const release = extra?.release
  const tag = release?.tag ?? str(f.latestRelease)
  const releaseText = release
    ? [
        release.name &&
        release.name !== release.tag &&
        !plainNotes(release.body)?.startsWith(release.name)
          ? release.name
          : null,
        plainNotes(release.body),
      ]
        .filter(Boolean)
        .join(' - ')
    : null
  const install = installCommands(readme)
  const bullets = featureBullets(readme)
  return lines(
    row('Repo', input.canonicalKey.replace(/^github:/, '')),
    row('Description', extra?.description ?? str(f.description) ?? m?.body?.split('\n')[0]),
    row('Stars', fmt(extra?.stars ?? m?.score)),
    row('Forks', fmt(extra?.forks ?? num(f.forks))),
    row('Language', extra?.language ?? str(f.language)),
    topics.length > 0 && `Topics: ${topics.slice(0, 8).join(', ')}`,
    row('Created', day(extra?.createdAt ?? m?.publishedAt)),
    tag &&
      `Latest release: ${tag}${release?.publishedAt ? ` (${day(release.publishedAt)})` : ''}${releaseText ? ` - ${clip(releaseText, 400)}` : ''}`,
    install.length > 0 &&
      `Install or run commands (verbatim):\n${install.map((c) => `- ${c}`).join('\n')}`,
    bullets.length > 0 && `README feature bullets:\n${bullets.map((b) => `- ${b}`).join('\n')}`,
    `README demo clip available: ${input.hasDemo ? 'yes' : 'no'}`,
  )
}

function isArticleText(text: string): boolean {
  return text.length > ARTICLE_COMMENT_LIMIT
}

const unquote = (t: string): string => t.replace(/^["“”\s]+|["“”\s]+$/g, '')

function commentsFor(m: BriefMention, input: BriefInput): BriefComment[] {
  const articles = input.mentions.flatMap((x) => x.extraTexts.filter(isArticleText))
  const quotesArticle = (text: string) => {
    const head = unquote(text).slice(0, 60)
    return head.length >= 40 && articles.some((a) => a.includes(head))
  }
  const fresh = m.externalId ? input.supplements?.comments?.[m.externalId] : undefined
  const all =
    fresh && fresh.length > 0
      ? [...fresh]
      : (m.source === 'hn' ? m.extraTexts.filter((t) => !isArticleText(t)) : [...m.extraTexts]).map(
          (text) => ({ author: null, score: null, text }),
        )
  return all
    .map((c) => ({ ...c, text: unquote(c.text) }))
    .filter((c) => c.text.length >= 20 && !quotesArticle(c.text))
}

function commentLines(comments: readonly BriefComment[]): string | null {
  const top = comments.slice(0, MAX_COMMENTS)
  if (top.length === 0) return null
  return `Top comments (untrusted opinions, not facts):\n${top
    .map(
      (c) =>
        `- ${c.author ? `${c.author}: ` : ''}"${clip(c.text, COMMENT_CHARS)}"${c.score !== null ? ` (${c.score} upvotes)` : ''}`,
    )
    .join('\n')}`
}

function articleFacts(m: BriefMention | undefined, input: BriefInput): string[] {
  const article = [...(m?.extraTexts ?? []), ...input.mentions.flatMap((x) => x.extraTexts)].find(
    (t) => isArticleText(t),
  )
  if (!article) return []
  const lead = leadSentences(article, 2)
  const nums = keyNumberSentences(article, 4)
  return lines(
    lead.length > 0 && `Linked article lead: ${lead.join(' ')}`,
    nums.length > 0 && `Linked article key numbers:\n${nums.map((s) => `- ${s}`).join('\n')}`,
  )
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function hnBrief(input: BriefInput): string[] {
  const m = input.mentions.find((x) => x.source === 'hn') ?? input.mentions[0]!
  return lines(
    row('Hacker News post', m.title),
    row('Points', fmt(m.score)),
    row('Comments', fmt(m.numComments)),
    row('Posted', day(m.publishedAt)),
    row('Linked site', hostOf(m.linkedUrl ?? input.canonicalUrl)),
    ...articleFacts(m, input),
    commentLines(commentsFor(m, input)),
  )
}

function redditBrief(input: BriefInput): string[] {
  const m = input.mentions.find((x) => x.source === 'reddit') ?? input.mentions[0]!
  const sub = typeof m.facts.subreddit === 'string' ? `r/${m.facts.subreddit}` : null
  return lines(
    row('Reddit post', m.title),
    row('Subreddit', sub),
    row('Score', fmt(m.score)),
    row('Comments', fmt(m.numComments)),
    row('Posted', day(m.publishedAt)),
    m.body && row('Post text', clip(m.body, 500)),
    row('Links to', hostOf(m.linkedUrl)),
    commentLines(commentsFor(m, input)),
  )
}

function youtubeBrief(input: BriefInput): string[] {
  const m = input.mentions.find((x) => x.source === 'youtube') ?? input.mentions[0]!
  const dur = typeof m.facts.durationSec === 'number' ? m.facts.durationSec : null
  return lines(
    row('Video', m.title),
    row('Channel', typeof m.facts.channel === 'string' ? m.facts.channel : m.author),
    row('Views', fmt(m.score)),
    row('Length', dur ? `${Math.floor(dur / 60)}m ${dur % 60}s` : null),
    row('Published', day(m.publishedAt)),
  )
}

function newsBrief(input: BriefInput): string[] {
  const m = input.mentions.find((x) => x.source === 'news') ?? input.mentions[0]
  const body = [m?.body ?? '', ...(m?.extraTexts ?? [])].join(' ')
  const nums = keyNumberSentences(body, 5)
  return lines(
    row('Headline', m?.title ?? input.title),
    row('Outlet', hostOf(m?.linkedUrl ?? m?.url ?? input.canonicalUrl)),
    row('Published', day(m?.publishedAt)),
    leadSentences(body, 2).length > 0 && `Lede: ${leadSentences(body, 2).join(' ')}`,
    nums.length > 0 && `Key numbers:\n${nums.map((s) => `- ${s}`).join('\n')}`,
  )
}

function discussionLines(input: BriefInput, primary: string): string[] {
  const seen = new Set<string>()
  const lines: string[] = []
  const others = input.mentions
    .filter((m) => m.source !== primary && (m.source === 'hn' || m.source === 'reddit'))
    .filter((m) => (m.score ?? 0) >= 5 || (m.numComments ?? 0) >= 3 || m.body)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  for (const m of others) {
    const key = `${m.source}:${m.title}`
    if (seen.has(key)) continue
    seen.add(key)
    const where =
      m.source === 'reddit' && typeof m.facts.subreddit === 'string'
        ? `r/${m.facts.subreddit}`
        : m.source === 'hn'
          ? 'Hacker News'
          : m.source
    const stats = [
      m.score !== null ? `${fmt(m.score)} points` : null,
      m.numComments !== null ? `${fmt(m.numComments)} comments` : null,
    ].filter(Boolean)
    const postNumbers = m.body ? keyNumberSentences(m.body, 2) : []
    const reaction = commentsFor(m, input)[0]
    lines.push(
      `Also discussed on ${where}: "${clip(m.title ?? '', 100)}"${stats.length ? ` (${stats.join(', ')})` : ''}${
        postNumbers.length > 0 ? `; the post says: ${postNumbers.join(' ')}` : ''
      }${reaction ? `; one reply: "${clip(reaction.text, 160)}"` : ''}`,
    )
    if (lines.length >= 2) break
  }
  return lines
}

export function briefKind(input: Pick<BriefInput, 'canonicalKey' | 'mentions' | 'paper'>): string {
  if (input.paper || input.canonicalKey.startsWith('arxiv:')) return 'paper'
  if (input.canonicalKey.startsWith('github:')) return 'github'
  if (input.canonicalKey.startsWith('youtube:')) return 'youtube'
  const sources = new Set(input.mentions.map((m) => m.source))
  if (sources.has('hn')) return 'hn'
  if (sources.has('reddit')) return 'reddit'
  return 'news'
}

/**
 * A short structured digest of the item placed above the raw source chunks, so the model sees the
 * facts a good reel opens with (real numbers, dates, reactions) without digging through prose.
 */
export function buildSourceBrief(input: BriefInput): SourceBrief {
  const kind = input.mentions.length === 0 ? 'news' : briefKind(input)
  const body =
    kind === 'paper' && input.paper
      ? paperBrief(input, input.paper)
      : kind === 'github'
        ? githubBrief(input)
        : kind === 'hn'
          ? hnBrief(input)
          : kind === 'reddit'
            ? redditBrief(input)
            : kind === 'youtube'
              ? youtubeBrief(input)
              : newsBrief(input)
  const primary = kind === 'hn' ? 'hn' : kind === 'reddit' ? 'reddit' : ''
  const extra = kind === 'paper' || kind === 'youtube' ? [] : discussionLines(input, primary)
  const text = [`SOURCE BRIEF (${kind})`, ...body, ...extra].join('\n')
  return { text, facts: text }
}
