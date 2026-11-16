import { writeFileSync } from 'node:fs'
import {
  DEFAULT_GATE_INSTRUCTIONS,
  claudeCostUsd,
  createDb,
  createLogger,
  gateVerdict,
  loadGateConfig,
} from '@reelset/core'
import { sql } from 'kysely'
import { GATE_V2_DEFAULT_INSTRUCTIONS } from '../../packages/core/src/domain/gate-legacy'
import { GATE_MAX_OUTPUT_TOKENS } from '../../workers/ingest/src/config'
import { createClaudeClient } from '../../workers/ingest/src/pipeline/claude'
import { loadGateItem } from '../../workers/ingest/src/pipeline/gate-manual'
import { parseGateOutput } from '../../workers/ingest/src/pipeline/gate-output'
import { buildGatePrompt } from '../../workers/ingest/src/pipeline/gate-prompt'

// Usage: gate-compare.ts --ids id1,id2 [--out file.json]
// Judges each item with the previous default instructions (gate-v2) and the current default, on the
// admin-selected gate model and effort. Labelled examples and Instagram results are left out, so the
// two runs differ only in the instructions and a posted item never sees its own result. Writes
// nothing to the database.
const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const ids = arg('--ids')?.split(',').filter(Boolean) ?? []
const out = arg('--out')
if (ids.length === 0) throw new Error('pass --ids id1,id2')

const log = createLogger({ app: 'gate-compare', level: 'warn' })
const { db, close } = createDb({ connectionString: process.env.DIRECT_URL!, log, max: 1 })
const RUNS = [
  { name: 'v2', instructions: GATE_V2_DEFAULT_INSTRUCTIONS },
  { name: 'v3', instructions: DEFAULT_GATE_INSTRUCTIONS },
] as const

try {
  const config = await loadGateConfig(db, log)
  const judge = createClaudeClient(process.env.CLAUDE_API_KEY!, config.model, log, {
    effort: config.effort,
    maxOutputTokens: GATE_MAX_OUTPUT_TOKENS,
    timeoutMs: 60_000,
  })
  console.log(`model=${config.model} effort=${config.effort} threshold=${config.threshold}`)
  const views = new Map(
    (
      await sql<{ item_id: string; view_count: number | null }>`
        select item_id, view_count from instagram_post where item_id::text = any(${ids})`.execute(
        db,
      )
    ).rows.map((r) => [r.item_id, r.view_count]),
  )
  const results = []
  let cost = 0
  for (const id of ids) {
    const item = await loadGateItem(db, id)
    const row: Record<string, unknown> = { id, title: item.title, views: views.get(id) ?? null }
    for (const run of RUNS) {
      const { prompt } = buildGatePrompt({ ...config, instructions: run.instructions }, [], item)
      if (!prompt) {
        row[run.name] = { error: 'over budget' }
        continue
      }
      const res = await judge.generate(prompt)
      cost += claudeCostUsd(config.model, res.usage)
      const parsed = parseGateOutput(res.text)
      row[run.name] = parsed.ok
        ? { ...parsed.value, verdict: gateVerdict(parsed.value.score, config.threshold) }
        : { error: parsed.reason }
    }
    const v2 = row.v2 as { score?: number }
    const v3 = row.v3 as { score?: number; reasons?: string[] }
    console.log(
      [
        String(row.views ?? '-').padStart(4),
        String(v2.score ?? 'err').padStart(4),
        String(v3.score ?? 'err').padStart(4),
        item.title.slice(0, 60).padEnd(60),
        (v3.reasons ?? []).join('; ').slice(0, 110),
      ].join(' | '),
    )
    results.push(row)
  }
  console.log(`total judge cost $${cost.toFixed(4)}`)
  if (out) writeFileSync(out, JSON.stringify(results, null, 2))
} finally {
  await close()
}
