import { githubSpamVerdict, type GithubSpamVerdict } from '@reelset/core'

export type SpamScanRow = {
  id: string
  title: string
  stars: number | null
  createdAt: Date | string
  author: string | null
  facts: unknown
  readme: string | null
}

export type SpamSuspect = { id: string; stars: number; verdict: GithubSpamVerdict }

type Facts = { description?: string | null; language?: string | null; topics?: string[] }

// Missing facts mean "unknown", so the heuristic skips its bare-repo rules instead of assuming them.
function parseFacts(raw: unknown): Facts {
  if (typeof raw !== 'object' || raw === null) return {}
  const facts = raw as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)
  const topics = Array.isArray(facts.topics)
    ? facts.topics.filter((t): t is string => typeof t === 'string')
    : []
  return { description: text(facts.description), language: text(facts.language), topics }
}

/** Runs the ingest spam heuristic over stored GitHub items, highest score first. */
export function findSpamSuspects(rows: readonly SpamScanRow[], now: Date): SpamSuspect[] {
  const suspects = rows.flatMap((row): SpamSuspect[] => {
    const facts = parseFacts(row.facts)
    const stars = row.stars ?? 0
    const verdict = githubSpamVerdict({
      fullName: row.title,
      ...facts,
      stars,
      createdAt: row.createdAt,
      ownerLogin: row.author,
      readme: row.readme,
      now,
    })
    return verdict.spam ? [{ id: row.id, stars, verdict }] : []
  })
  return suspects.sort((a, b) => b.verdict.score - a.verdict.score || b.stars - a.stars)
}
