import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'kysely'
import {
  DEFAULT_CLAUDE_MODEL,
  claudeCostUsd,
  claudeEffortSchema,
  claudeModelSchema,
  createDb,
  createLogger,
  paperEvidenceTexts,
  parseItemImages,
  parsedPaperSchema,
  type ParsedPaper,
} from '@reelset/core'
import { enrichItem } from '../../workers/ingest/src/brief-fetch'
import { createClaudeClient } from '../../workers/ingest/src/pipeline/claude'
import { buildSourceBrief } from '../../workers/ingest/src/pipeline/brief'
import {
  buildEvidenceRows,
  hasDemo,
  parseExtraTexts,
  parseFacts,
  selectPromptChunks,
} from '../../workers/ingest/src/pipeline/decide'
import { parseModelOutput } from '../../workers/ingest/src/pipeline/output'
import { NARRATION_LIMITS } from '../../workers/ingest/src/pipeline/process'
import { paperAssetsPrompt, resolvePaperShots } from '../../workers/ingest/src/pipeline/paper-shots'
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
} from '../../workers/ingest/src/pipeline/prompt'
import { allowedImageSet, validateGenerated } from '../../workers/ingest/src/pipeline/safety'
import { narrationWordCount, numberValues } from '../../workers/ingest/src/pipeline/shots'

// Usage: gen-claude-samples.ts <outDir> <slug>=<itemId> [...] [--model <id>] [--effort low|medium|high] [--attempts N]
// Live Claude calls for real items without writing to the database. Writes <outDir>/<slug>.json
// (script, usage, cost, attempts, brief) for side-by-side review.
const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const effort = claudeEffortSchema.parse(flag('--effort') ?? 'medium')
const model = claudeModelSchema.parse(flag('--model') ?? DEFAULT_CLAUDE_MODEL)
const attempts = Number(flag('--attempts') ?? 3)
const dry = args.includes('--dry')
if (dry) args.splice(args.indexOf('--dry'), 1)
const [outDir, ...specs] = args
mkdirSync(outDir!, { recursive: true })

const log = createLogger({ app: 'gen-claude-samples', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const llm = createClaudeClient(process.env.CLAUDE_API_KEY!, model, log, { effort })

async function loadPaper(arxivId: string): Promise<ParsedPaper | null> {
  const res = await fetch(`https://media.reelset.app/papers/${arxivId}/paper.json`)
  return res.ok ? parsedPaperSchema.parse(await res.json()) : null
}

async function one(slug: string, itemId: string) {
  const item = (
    await sql<any>`select id, title, kind, canonical_key, canonical_url, images, demo, script, prompt_version from item where id = ${itemId}`.execute(
      db,
    )
  ).rows[0]
  const mentions = (
    await sql<any>`select id, source, external_id, url, title, body, raw, author, score, num_comments, published_at from mention where item_id = ${itemId} order by published_at asc`.execute(
      db,
    )
  ).rows
  const images = parseItemImages(item.images)
  const arxivId = item.canonical_key.startsWith('arxiv:') ? item.canonical_key.slice(6) : null
  const paper = arxivId ? await loadPaper(arxivId) : null
  const enrichment = await enrichItem(
    item.canonical_key,
    mentions.map((m: any) => ({
      id: m.id,
      source: m.source,
      externalId: m.external_id,
      extraTexts: parseExtraTexts(m.raw),
      facts: parseFacts(m.raw),
    })),
    { log, githubToken: process.env.GITHUB_TOKEN },
  )
  const rows = buildEvidenceRows(
    mentions.map((m: any) => ({
      id: m.id,
      source: m.source,
      title: m.title,
      body: m.body,
      extraTexts: [
        ...(paper && m.source === 'papers' ? paperEvidenceTexts(paper) : parseExtraTexts(m.raw)),
        ...(enrichment.extraTexts.get(m.id) ?? []),
      ],
    })),
    null,
  )
  const chunks = rows.map((r) => ({ id: randomUUID(), text: r.text }))
  const promptChunks = selectPromptChunks(chunks)
  const promptIds = new Set(promptChunks.map((c) => c.id))
  const brief = buildSourceBrief({
    kind: item.kind,
    title: item.title,
    canonicalKey: item.canonical_key,
    canonicalUrl: item.canonical_url,
    mentions: mentions.map((m: any) => ({
      source: m.source,
      url: m.url,
      title: m.title,
      body: m.body,
      author: m.author,
      score: m.score,
      numComments: m.num_comments,
      publishedAt: m.published_at,
      facts: parseFacts(m.raw),
      extraTexts: parseExtraTexts(m.raw),
      externalId: m.external_id,
    })),
    paper,
    hasDemo: hasDemo(item.demo),
    supplements: enrichment.supplements,
  })
  const sourceText = [
    brief.facts,
    item.title,
    item.canonical_url,
    ...mentions.map((m: any) => `${m.url} ${m.title ?? ''}`),
    ...chunks.map((c) => c.text),
  ].join('\n')
  const imageUrls = [
    ...allowedImageSet(
      mentions.map((m: any) => ({ source: m.source, externalId: m.external_id })),
      [...chunks.map((c) => c.text), ...mentions.map((m: any) => m.body ?? '')],
    ),
  ]
  const userBase = {
    title: item.title,
    kind: item.kind,
    canonicalUrl: item.canonical_url,
    chunks: promptChunks,
    imageUrls,
    paperAssets: paper ? paperAssetsPrompt(paper, images) : undefined,
    brief: brief.text,
  }

  if (dry) {
    writeFileSync(join(outDir!, `${slug}.prompt.txt`), buildUserPrompt(userBase))
    console.log(slug, 'dry run, prompt chars', buildUserPrompt(userBase).length)
    return
  }
  const calls: unknown[] = []
  let rejection: string | undefined
  let accepted: unknown = null
  let totalCost = 0
  for (let attempt = 1; attempt <= attempts && !accepted; attempt++) {
    const started = performance.now()
    const res = await llm.generate({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ ...userBase, rejection }),
    })
    const cost = claudeCostUsd(model, res.usage)
    totalCost += cost
    const parsed = parseModelOutput(res.text, promptIds, sourceText, NARRATION_LIMITS)
    let outcome = 'accepted'
    if (!parsed.ok) {
      rejection = parsed.reason
      outcome = `parse: ${parsed.reason}`
    } else {
      const verdict = validateGenerated({
        ...parsed.value,
        sourceText,
        chunkIds: new Set(chunks.map((c) => c.id)),
        allowedImageUrls: new Set(imageUrls),
      })
      if (!verdict.ok) {
        rejection = verdict.reasons.join('; ')
        outcome = `safety: ${rejection}`
      } else accepted = parsed.value
    }
    calls.push({
      attempt,
      outcome,
      usage: res.usage,
      costUsd: cost,
      ms: Math.round(performance.now() - started),
      raw: res.text.slice(0, 9000),
    })
    console.log(slug, `attempt ${attempt}`, outcome.slice(0, 160), `$${cost.toFixed(5)}`)
  }

  let paperStats: unknown = null
  if (accepted && paper) {
    paperStats = resolvePaperShots(
      (accepted as { script: unknown }).script as { beats?: unknown },
      paper,
      images,
    )
  }
  const script = (accepted as { script?: any } | null)?.script
  const scriptText = script
    ? JSON.stringify(script, (k, v) => (k === 'claims' ? undefined : v))
    : ''
  const known = numberValues(sourceText)
  const ungrounded = script ? [...numberValues(scriptText)].filter((n) => !known.has(n)) : null
  const result = {
    slug,
    itemId,
    promptVersion: PROMPT_VERSION,
    model,
    effort,
    accepted: !!accepted,
    words: script ? narrationWordCount(script) : null,
    ungroundedNumbers: ungrounded,
    content: accepted,
    paperStats,
    attempts: calls,
    totalCostUsd: totalCost,
    briefText: brief.text,
    storedScript: item.script ?? null,
    storedPromptVersion: item.prompt_version,
  }
  writeFileSync(join(outDir!, `${slug}.json`), JSON.stringify(result, null, 2))
  console.log(slug, accepted ? 'OK' : 'FAILED', `words=${result.words}`, `$${totalCost.toFixed(5)}`)
}

try {
  for (const spec of specs) {
    const [slug, id] = spec.split('=')
    await one(slug!, id!)
  }
} finally {
  await close()
}
