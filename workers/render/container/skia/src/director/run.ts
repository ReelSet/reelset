import type Anthropic from '@anthropic-ai/sdk'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { log } from '../engine/log'
import type { DrawChild } from './child'
import {
  NO_USAGE,
  REPORT_FILE,
  type DirectorConfig,
  type DirectorResult,
  type DrawReport,
  type FallbackReason,
  type Usage,
} from './config'
import { extractCode } from './extract'
import type { AskModel, ChatMessage } from './model'
import { briefOf, reviewText, systemText, type ReelData } from './prompt'

export type DirectorRun = {
  jobDir: string
  config: DirectorConfig
  /** Null when no API key is available. */
  ask: AskModel | null
  draw: DrawChild
  data: ReelData
  iconNames: string[]
  now?: () => number
}

type Draft = { code: string; text: string }

class Fallback extends Error {
  constructor(readonly reason: FallbackReason) {
    super(reason)
  }
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
})

function readReport(file: string): DrawReport | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DrawReport
  } catch {
    return null
  }
}

/** Renders raw.mp4 for the job: the model's scenes when everything works, the generic renderer otherwise. */
export async function runDirector(run: DirectorRun): Promise<DirectorResult> {
  const { jobDir, config, data } = run
  const now = run.now ?? Date.now
  const started = now()
  const jobId = path.basename(jobDir)
  const work = path.join(jobDir, 'director')
  const reportFile = path.join(work, REPORT_FILE)
  const sheetFile = path.join(work, 'review.jpg')
  const scriptFile = path.join(work, 'scenes.js')
  const system = systemText(config, run.iconNames)
  let usage: Usage = { ...NO_USAGE }
  mkdirSync(work, { recursive: true })

  const result = (scenes: number, sceneErrors: number, reason: FallbackReason | null) => ({
    used: reason === null,
    model: config.model,
    scenes,
    sceneErrors,
    fallbackReason: reason,
    ...usage,
    ms: now() - started,
  })

  async function ask(messages: ChatMessage[]): Promise<Draft | null> {
    const reply = await run.ask!(system, messages)
    usage = addUsage(usage, reply.usage)
    if (reply.stopReason === 'refusal') return null
    const code = extractCode(reply.text)
    return code ? { code, text: reply.text } : null
  }

  async function runChild(code: string, extra: string[]) {
    writeFileSync(scriptFile, code)
    rmSync(reportFile, { force: true })
    const out = await run.draw([jobDir, '--scenes', scriptFile, '--report', reportFile, ...extra])
    if (out.stalled) throw new Fallback('timeout')
    return { exit: out.code, report: readReport(reportFile) }
  }

  async function firstDraft(brief: ChatMessage): Promise<Draft> {
    try {
      const draft = await ask([brief])
      if (draft) return draft
    } catch (err) {
      log.warn({ jobId, err: (err as Error).message }, 'director model call failed')
    }
    throw new Fallback('api_error')
  }

  async function reviewed(brief: ChatMessage, first: Draft): Promise<string[]> {
    rmSync(sheetFile, { force: true })
    const { report } = await runChild(first.code, ['--review-sheet', sheetFile])
    const hasSheet = existsSync(sheetFile)
    const loadError = report?.loadError ?? null
    const notes = {
      loadError,
      hasSheet,
      sceneErrors: (report?.sceneErrors ?? []).map((e) => `scene ${e.scene}: ${e.message}`),
    }
    const content: Anthropic.ContentBlockParam[] = []
    if (hasSheet)
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: readFileSync(sheetFile).toString('base64'),
        },
      })
    content.push({ type: 'text', text: reviewText(config, notes) })
    let second: Draft | null = null
    try {
      second = await ask([
        brief,
        { role: 'assistant', content: first.text },
        { role: 'user', content },
      ])
    } catch (err) {
      log.warn({ jobId, err: (err as Error).message }, 'director review call failed')
    }
    log.info({ jobId, loadError: loadError !== null, revised: second !== null }, 'director review')
    if (!second) {
      if (loadError) throw new Fallback('load_error')
      return [first.code]
    }
    return loadError ? [second.code] : [second.code, first.code]
  }

  async function renderFinal(candidates: string[]): Promise<DirectorResult> {
    for (const code of candidates) {
      const { exit, report } = await runChild(code, [])
      if (exit === 0 && report && !report.loadError)
        return result(report.scenes, report.sceneErrors.length, null)
      if (!report?.loadError) throw new Fallback('crash')
      log.warn({ jobId, loadError: report.loadError }, 'script failed to load, trying the next')
    }
    throw new Fallback('load_error')
  }

  async function genericRender(reason: FallbackReason): Promise<DirectorResult> {
    log.warn({ jobId, reason }, 'director fell back to the generic renderer')
    rmSync(path.join(jobDir, 'raw.mp4'), { force: true })
    const out = await run.draw([jobDir])
    if (out.code !== 0) throw new Error(`generic render failed code=${out.code}`)
    return result(0, 0, reason)
  }

  if (!run.ask) return genericRender('no_api_key')
  try {
    const brief: ChatMessage = { role: 'user', content: briefOf(data) }
    const first = await firstDraft(brief)
    const candidates = config.review ? await reviewed(brief, first) : [first.code]
    return await renderFinal(candidates)
  } catch (err) {
    if (err instanceof Fallback) return genericRender(err.reason)
    throw err
  }
}
