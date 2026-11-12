// node dist/render.mjs <jobDir>: renders <jobDir>/raw.mp4 (+ timeline.json). Holds the API key; never runs model code.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../engine/log'
import { buildReel, type ReelProps } from '../plan'
import { createDrawChild, scrubbedEnv } from './child'
import { parseDirectorConfig, type DirectorResult } from './config'
import { createAskModel } from './model'
import { dataOf } from './prompt'
import { runDirector } from './run'

const RESULT_FILE = 'director-result.json'
const here = path.dirname(fileURLToPath(import.meta.url))
const forwardable = (line: string) => line !== '' && !line.startsWith('tick ')

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function iconNames(): string[] {
  const assets = process.env.SKIA_ASSETS ?? path.join(here, '..', 'assets')
  const icons = readJson(path.join(assets, 'icons.json'))
  return icons && typeof icons === 'object' ? Object.keys(icons).sort() : []
}

async function main(): Promise<void> {
  const jobDir = process.argv[2]
  if (!jobDir) throw new Error('usage: node render.mjs <jobDir>')
  const jobId = path.basename(jobDir)
  const draw = createDrawChild({
    script: path.join(here, 'draw.mjs'),
    env: scrubbedEnv(process.env),
    forward: (line) => forwardable(line) && console.log(line),
  })
  const config = parseDirectorConfig(readJson(path.join(jobDir, 'director.json')))
  if (!config) {
    const out = await draw([jobDir])
    if (out.code !== 0) throw new Error(`render failed code=${out.code}`)
    return
  }
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || null
  log.info(
    { jobId, model: config.model, review: config.review, hasKey: apiKey !== null },
    'director start',
  )
  const props = JSON.parse(readFileSync(path.join(jobDir, 'props.json'), 'utf8')) as ReelProps
  const result: DirectorResult = await runDirector({
    jobDir,
    config,
    ask: apiKey ? createAskModel(apiKey, config) : null,
    draw,
    data: dataOf(buildReel(props)),
    iconNames: iconNames(),
  })
  writeFileSync(path.join(jobDir, RESULT_FILE), JSON.stringify(result))
  log.info({ jobId, ...result }, 'director done')
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error({ err: (err as Error).stack?.slice(0, 800) }, 'render failed')
    process.exit(1)
  },
)
