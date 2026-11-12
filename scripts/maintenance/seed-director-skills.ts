import { readFileSync, existsSync } from 'node:fs'
import {
  DIRECTOR_SKILLS_MAX_CHARS,
  approxTokens,
  createDb,
  createLogger,
  listSkills,
  setSkillEnabled,
  upsertSkill,
  type SkillInput,
} from '@reelset/core'

// Usage: npx tsx scripts/maintenance/seed-director-skills.ts [--dry-run]
// Upserts (by name) the reel-craft skill and the example scene script, and switches off the four
// large source skills it was distilled from (kept in the table so admin can switch them back on).
const dryRun = process.argv.includes('--dry-run')
const ASSETS = new URL('../../workers/render/container/skia/assets/director/', import.meta.url)
  .pathname
const SKILL_NAME = 'reel-craft'
const EXAMPLE_NAME = 'motion-v2-example'
const RETIRED_SKILLS = [
  'motion-design',
  'design-motion-principles',
  'motion-doctrine',
  'cut-the-curve',
]

function fromAsset(name: string, kind: SkillInput['kind'], file: string): SkillInput {
  const path = ASSETS + file
  if (!existsSync(path)) throw new Error(`director asset missing: ${path}`)
  return { name, kind, content: readFileSync(path, 'utf8') }
}

const entries = [
  fromAsset(SKILL_NAME, 'skill', 'reel-craft.md'),
  fromAsset(EXAMPLE_NAME, 'example', 'example-scenes.js'),
]
const skillChars = entries
  .filter((e) => e.kind === 'skill')
  .reduce((n, e) => n + e.content.length, 0)

for (const e of entries) {
  const kb = (e.content.length / 1024).toFixed(1)
  console.log(`${e.kind.padEnd(8)} ${e.name.padEnd(28)} ${kb.padStart(8)} KB`)
}
console.log(
  `skills total ${(skillChars / 1024).toFixed(0)} KB (about ${approxTokens(skillChars)} tokens); limit ${DIRECTOR_SKILLS_MAX_CHARS} chars`,
)
if (skillChars > DIRECTOR_SKILLS_MAX_CHARS) console.warn('warning: over the skill size limit')

if (dryRun) {
  console.log('dry run: nothing written')
} else {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required')
  const log = createLogger({ app: 'seed-director-skills', level: 'info' })
  const { db, close } = createDb({ connectionString, log, max: 1 })
  try {
    for (const entry of entries) await upsertSkill(db, entry, log)
    console.log(`upserted ${entries.length} entries`)
    for (const row of await listSkills(db)) {
      if (!RETIRED_SKILLS.includes(row.name) || !row.enabled) continue
      await setSkillEnabled(db, row.id, false, log)
      console.log(`switched off ${row.name}`)
    }
  } finally {
    await close()
  }
}
