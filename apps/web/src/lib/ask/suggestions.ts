import { topicLabel } from '@/lib/seo/site'

export const FALLBACK_SUGGESTIONS = [
  'What is new in AI coding agents this week?',
  'Which databases are developers talking about?',
  'Any big security incidents lately?',
  'What are people building with Rust?',
]

export const SUGGESTION_COUNT = 4
const MAX_TITLE_CHARS = 64
const TOPIC_TEMPLATES = [
  (t: string) => `What is trending in ${t} this week?`,
  (t: string) => `What are developers saying about ${t} right now?`,
]

export type TopicStat = { label: string; count: number }

// Real-data starters, no LLM: the busiest recent topics plus the newest reel titles.
export function buildSuggestions(
  topics: readonly TopicStat[],
  titles: readonly string[],
  count = SUGGESTION_COUNT,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (question: string) => {
    const key = question.toLowerCase()
    if (out.length >= count || seen.has(key)) return
    seen.add(key)
    out.push(question)
  }

  const topTopics = [...topics]
    .filter((t) => t.label.trim().length >= 2 && t.label.length <= 24)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
  topTopics.forEach((t, i) =>
    add(TOPIC_TEMPLATES[i % TOPIC_TEMPLATES.length]!(topicLabel(t.label))),
  )

  for (const raw of titles) {
    const title = raw.replace(/\s+/g, ' ').trim()
    if (title.length < 8 || title.length > MAX_TITLE_CHARS) continue
    add(`What is the story behind ${title.replace(/[?.!]+$/, '')}?`)
  }
  for (const fallback of FALLBACK_SUGGESTIONS) add(fallback)
  return out
}

// Used when a cached answer carries no model follow-ups: ask about the cited stories instead.
export function followupsFromTitles(titles: readonly string[], count = 3): string[] {
  const out: string[] = []
  for (const raw of titles) {
    const title = raw.replace(/\s+/g, ' ').trim()
    if (title.length < 8 || title.length > MAX_TITLE_CHARS) continue
    const q = `What else should I know about ${title.replace(/[?.!]+$/, '')}?`
    if (!out.includes(q)) out.push(q)
    if (out.length === count) break
  }
  return out
}
