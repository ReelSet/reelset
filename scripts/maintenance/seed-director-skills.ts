import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import {
  DIRECTOR_SKILLS_MAX_CHARS,
  approxTokens,
  createDb,
  createLogger,
  upsertSkill,
  type SkillInput,
} from '@reelset/core'

// Usage: npx tsx scripts/maintenance/seed-director-skills.ts [--dry-run]
// Upserts (by name) the director skills from ~/.agents/skills plus the example scene script.
const dryRun = process.argv.includes('--dry-run')
const SKILL_FOLDERS = [
  'motion-design',
  'design-motion-principles',
  'motion-doctrine',
  'cut-the-curve',
]
const SKILLS_ROOT = join(homedir(), '.agents', 'skills')
const EXAMPLE_NAME = 'motion-v2-example'
const EXAMPLE_PATHS = [
  new URL('../../workers/render/container/skia/assets/director/example-scenes.js', import.meta.url)
    .pathname,
  '/private/tmp/claude-501/-Users-mehul-Desktop-code-my-projects-reelset/81e34b65-0dd1-4b66-b3e7-7fc29b6574c5/scratchpad/variants/motion-v2/scenes.mjs',
]

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return markdownFiles(path)
      return name.toLowerCase().endsWith('.md') ? [path] : []
    })
}

function skillFromFolder(name: string): SkillInput {
  const dir = join(SKILLS_ROOT, name)
  if (!existsSync(dir)) throw new Error(`skill folder missing: ${dir}`)
  const files = markdownFiles(dir).sort((a, b) => relative(dir, a).localeCompare(relative(dir, b)))
  const content = files
    .map((file) => `<file path="${relative(dir, file)}">\n${readFileSync(file, 'utf8')}\n</file>`)
    .join('\n')
  return { name, kind: 'skill', content }
}

function exampleEntry(): SkillInput {
  const path = EXAMPLE_PATHS.find((p) => existsSync(p))
  if (!path) throw new Error(`example scenes not found in: ${EXAMPLE_PATHS.join(', ')}`)
  return { name: EXAMPLE_NAME, kind: 'example', content: readFileSync(path, 'utf8') }
}

const entries = [...SKILL_FOLDERS.map(skillFromFolder), exampleEntry()]
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
  } finally {
    await close()
  }
}
