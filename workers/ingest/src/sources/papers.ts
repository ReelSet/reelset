import { errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { extractPaperSections } from '../arxiv-html'
import { fetchPageText } from '../article'
import {
  ARXIV_API_URL,
  ARXIV_HOST_INTERVAL_MS,
  HF_PAPERS_URL,
  PAPERS_CONCLUSION_CHARS,
  PAPERS_INTRO_CHARS,
  PAPERS_MAX_EVIDENCE_FETCHES,
  PAPERS_MIN_SECTION_CHARS,
  PAPERS_SCOPE_ARXIV,
  PAPERS_SCOPE_HF,
  USER_AGENT,
} from '../config'
import { decodeEntities, truncate } from '../html'
import { fetchJson, fetchText } from '../http'
import type { AdapterOutcome, FetchContext, NormalizedMention, SourceAdapter } from '../types'

const ABSTRACT_CHARS = 3000
const AUTHORS_SHOWN = 6
const DAY_MS = 24 * 60 * 60 * 1000

const hfEntrySchema = z.looseObject({
  title: z.string().nullish(),
  numComments: z.number().nullish(),
  paper: z.looseObject({
    id: z.string().min(1),
    title: z.string().nullish(),
    summary: z.string().nullish(),
    upvotes: z.number().nullish(),
    publishedAt: z.string().nullish(),
    submittedOnDailyAt: z.string().nullish(),
    authors: z.array(z.looseObject({ name: z.string().nullish() })).nullish(),
  }),
})
export type HfEntry = z.infer<typeof hfEntrySchema>

export function paperUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`
}

function authorLine(names: readonly string[]): string | null {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (clean.length === 0) return null
  const shown = clean.slice(0, AUTHORS_SHOWN).join(', ')
  return clean.length > AUTHORS_SHOWN ? `${shown} et al.` : shown
}

function oneLine(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim()
}

function paperBody(authors: string | null, abstract: string): string {
  const parts = [authors ? `Authors: ${authors}` : null, `Abstract: ${abstract}`]
  return truncate(parts.filter(Boolean).join('\n\n'), ABSTRACT_CHARS)
}

export function hfEntryToMention(entry: HfEntry): NormalizedMention | null {
  const { paper } = entry
  const title = oneLine(paper.title ?? entry.title ?? '')
  const abstract = oneLine(paper.summary ?? '')
  // Recency for ranking is when the community surfaced the paper, not its arXiv submission date.
  const arxivAt = new Date(paper.publishedAt ?? '')
  const dailyAt = new Date(paper.submittedOnDailyAt ?? '')
  const publishedAt = dailyAt.getTime() > arxivAt.getTime() ? dailyAt : arxivAt
  if (!title || !abstract || Number.isNaN(publishedAt.getTime())) return null
  const authors = authorLine((paper.authors ?? []).map((a) => a.name ?? ''))
  return {
    source: 'papers',
    externalId: paper.id,
    kind: 'article',
    url: paperUrl(paper.id),
    linkedUrl: null,
    title,
    author: authors,
    body: paperBody(authors, abstract),
    score: paper.upvotes ?? 0,
    numComments: entry.numComments ?? 0,
    publishedAt,
    extraTexts: [],
  }
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? oneLine(m[1] ?? '') : null
}

const ARXIV_ID_FROM_ENTRY = /arxiv\.org\/abs\/([^\sv]+(?:\/\d+)?)(?:v\d+)?/i

export function parseArxivFeed(xml: string): NormalizedMention[] {
  const out: NormalizedMention[] = []
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = m[1] ?? ''
    const id = ARXIV_ID_FROM_ENTRY.exec(tag(block, 'id') ?? '')?.[1]
    const title = tag(block, 'title')
    const abstract = tag(block, 'summary')
    const publishedAt = new Date(tag(block, 'published') ?? '')
    if (!id || !title || !abstract || Number.isNaN(publishedAt.getTime())) continue
    const names = [...block.matchAll(/<author\b[^>]*>\s*<name>([\s\S]*?)<\/name>/gi)].map((a) =>
      oneLine(a[1] ?? ''),
    )
    const authors = authorLine(names)
    out.push({
      source: 'papers',
      externalId: id,
      kind: 'article',
      url: paperUrl(id),
      linkedUrl: null,
      title,
      author: authors,
      body: paperBody(authors, abstract),
      score: null,
      numComments: null,
      publishedAt,
      extraTexts: [],
    })
  }
  return out
}

export function paperEvidenceText(html: string): string {
  const { intro, conclusion } = extractPaperSections(html)
  return [
    intro ? `Introduction: ${truncate(intro, PAPERS_INTRO_CHARS)}` : null,
    conclusion ? `Conclusion: ${truncate(conclusion, PAPERS_CONCLUSION_CHARS)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function attachEvidence(
  mentions: NormalizedMention[],
  log: Logger,
  ctx: FetchContext,
): Promise<void> {
  const top = [...mentions]
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, PAPERS_MAX_EVIDENCE_FETCHES)
  for (const mention of top) {
    if (performance.now() > ctx.deadlineAt) {
      log.warn('papers evidence hit time budget, stopping early')
      break
    }
    const page = await fetchPageText(`https://arxiv.org/html/${mention.externalId}`, log, {
      scrape: ctx.scrape,
      extract: paperEvidenceText,
      minChars: PAPERS_MIN_SECTION_CHARS,
      maxChars: PAPERS_INTRO_CHARS + PAPERS_CONCLUSION_CHARS + 200,
      hostIntervalMs: ctx.hostIntervalMs,
    }).catch((err) => {
      log.warn({ paper: mention.externalId, ...errorFields(err) }, 'paper evidence fetch failed')
      return null
    })
    if (page?.text) mention.extraTexts = [page.text]
    log.debug(
      { paper: mention.externalId, via: page?.via, chars: page?.text.length ?? 0 },
      'paper evidence',
    )
  }
}

function inRange(m: NormalizedMention, ctx: FetchContext, maxAgeDays: number): boolean {
  if (m.publishedAt <= ctx.range.after) return false
  if (ctx.range.before && m.publishedAt >= ctx.range.before) return false
  return m.publishedAt.getTime() >= ctx.now.getTime() - maxAgeDays * DAY_MS
}

async function fetchHf(log: Logger, ctx: FetchContext): Promise<NormalizedMention[]> {
  const { papersHfLimit, papersMaxAgeDays } = ctx.settings
  const json = await fetchJson<unknown[]>(`${HF_PAPERS_URL}?limit=${papersHfLimit}`, log, {
    headers: { 'user-agent': USER_AGENT },
    hostIntervalMs: ctx.hostIntervalMs,
  })
  const mentions: NormalizedMention[] = []
  for (const raw of json) {
    const parsed = hfEntrySchema.safeParse(raw)
    if (!parsed.success) continue
    const mention = hfEntryToMention(parsed.data)
    if (mention && inRange(mention, ctx, papersMaxAgeDays)) mentions.push(mention)
  }
  return mentions
}

async function fetchArxiv(log: Logger, ctx: FetchContext): Promise<NormalizedMention[]> {
  const { papersArxivCategories: categories, papersArxivPerCategory: perCategory } = ctx.settings
  const mentions: NormalizedMention[] = []
  if (perCategory === 0) return mentions
  for (const category of categories) {
    if (performance.now() > ctx.deadlineAt) break
    try {
      const params = new URLSearchParams({
        search_query: `cat:${category}`,
        sortBy: 'submittedDate',
        sortOrder: 'descending',
        max_results: String(perCategory),
      })
      const xml = await fetchText(`${ARXIV_API_URL}?${params.toString()}`, log, {
        headers: { 'user-agent': USER_AGENT },
        hostIntervalMs: Math.max(ctx.hostIntervalMs, ARXIV_HOST_INTERVAL_MS),
      })
      mentions.push(
        ...parseArxivFeed(xml).filter((m) => inRange(m, ctx, ctx.settings.papersMaxAgeDays)),
      )
    } catch (err) {
      log.warn({ category, ...errorFields(err) }, 'arxiv category fetch failed')
    }
  }
  return mentions
}

async function fetchPapers(scope: string, log: Logger, ctx: FetchContext): Promise<AdapterOutcome> {
  const l = log.child({ source: 'papers', scope })
  const mentions = scope === PAPERS_SCOPE_HF ? await fetchHf(l, ctx) : await fetchArxiv(l, ctx)

  const seen = new Set<string>()
  const unique = mentions.filter((m) => !seen.has(m.externalId) && seen.add(m.externalId))
  await attachEvidence(unique, l, ctx)
  l.info({ mentions: unique.length }, 'papers fetch complete')
  return { mentions: unique, exhausted: true }
}

export const papersAdapter: SourceAdapter = {
  source: 'papers',
  scopes: (settings) => [
    PAPERS_SCOPE_HF,
    ...(settings.papersArxivPerCategory > 0 && settings.papersArxivCategories.length > 0
      ? [PAPERS_SCOPE_ARXIV]
      : []),
  ],
  rollingWindowMs: 7 * DAY_MS,
  fetch: fetchPapers,
}
