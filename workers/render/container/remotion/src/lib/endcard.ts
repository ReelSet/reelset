import { sameIdea } from './ideas'
import type { ItemFacts, ReelDemo, Source } from './types'

export type EndCtx = {
  title: string
  source: Source
  domain: string
  headline?: string
  facts: ItemFacts
  demo?: ReelDemo
}

const sentence = (t: string) => t.replace(/^(\p{Ll})/u, (c) => c.toUpperCase())

/** First sentence of a description, at most 90 characters, cut on a word. */
function brief(text: string): string {
  const first =
    text
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? ''
  if (first.length <= 90) return first.replace(/\.$/, '')
  return `${first.slice(0, 89).replace(/\s+\S*$/, '')}…`
}

/** What the reel was about, by name: the repo, the paper's short name, else the source title. */
export function endName(ctx: EndCtx): string {
  const r = ctx.facts.repo
  if (r?.owner && r.name) return `${r.owner}/${r.name}`
  if (ctx.demo?.repo) return ctx.demo.repo
  const head = /^([^:]{2,24}):\s/.exec(ctx.title)?.[1]
  if (ctx.source === 'papers' && head) return head
  return ctx.headline?.trim() || ctx.title
}

/** Where the reel came from, as one line: "github.com/owner/repo", "arxiv.org", the article's site. */
export function endSource(ctx: EndCtx): string {
  const r = ctx.facts.repo
  const repo = r?.owner && r.name ? `${r.owner}/${r.name}` : ctx.demo?.repo
  if (ctx.source === 'github' && repo) return `github.com/${repo}`
  return ctx.domain
}

/**
 * The line under the big name: what the thing is, in the source's own words. A repo shows its
 * description (never the item title, which is often a raw release or commit title); a paper shows its
 * title without the short name it already led with; nothing that repeats the name or the headline,
 * and always sentence-cased.
 */
export function endSubtitle(ctx: EndCtx): string {
  const name = endName(ctx)
  let sub = ''
  if (ctx.source === 'github') {
    sub = brief(ctx.facts.repo?.description ?? '')
  } else {
    const title = ctx.title.trim()
    const prefix = new RegExp(
      `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-–—]\\s*`,
      'i',
    )
    sub = title.replace(prefix, '').trim()
  }
  if (!sub) return ''
  const others = [name, ctx.headline ?? ''].filter(Boolean)
  if (others.some((o) => sub.toLowerCase() === o.toLowerCase() || sameIdea(sub, o))) return ''
  return sentence(sub)
}
