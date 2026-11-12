import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildOutcome, DrawChild } from './child'
import type { DirectorConfig, DrawReport } from './config'
import type { AskModel, ModelReply } from './model'
import { runDirector } from './run'

const config: DirectorConfig = {
  model: 'claude-haiku-5-5',
  effort: 'medium',
  maxTokens: 1000,
  review: true,
  rules: 'RULES',
  reviewPrompt: 'REVIEW',
  skills: [],
  example: null,
}
const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 7 }
const reply = (text: string, stopReason = 'end_turn'): ModelReply => ({ text, stopReason, usage })
const block = (code: string) => `Here you go\n\`\`\`js\n${code}\n\`\`\``
const okReport: DrawReport = {
  loadError: null,
  scenes: 6,
  sceneErrors: [{ scene: 2, message: 'x' }],
}

type Call = { args: string[] }
type DrawScript = (args: string[], dir: string) => ChildOutcome | Promise<ChildOutcome>

let dir: string
let calls: Call[]

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'director-run-'))
  calls = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const flagOf = (args: string[], name: string) => args[args.indexOf(`--${name}`) + 1]!

function fakeDraw(script: DrawScript): DrawChild {
  return async (args) => {
    calls.push({ args })
    return script(args, dir)
  }
}

const reportAndSheet =
  (report: DrawReport, sheet = true): DrawScript =>
  (args) => {
    writeFileSync(flagOf(args, 'report'), JSON.stringify(report))
    if (sheet && args.includes('--review-sheet'))
      writeFileSync(flagOf(args, 'review-sheet'), 'JPEG')
    return { code: 0, stalled: false }
  }

const run = (ask: AskModel | null, draw: DrawChild, cfg: DirectorConfig = config) =>
  runDirector({
    jobDir: dir,
    config: cfg,
    ask,
    draw,
    data: {} as never,
    iconNames: ['arrow-up'],
    now: (() => {
      let t = 1000
      return () => (t += 250)
    })(),
  })

describe('runDirector', () => {
  it('falls back to the generic renderer without an API key', async () => {
    const out = await run(
      null,
      fakeDraw(() => ({ code: 0, stalled: false })),
    )
    expect(out).toMatchObject({
      used: false,
      fallbackReason: 'no_api_key',
      scenes: 0,
      inputTokens: 0,
    })
    expect(calls.map((c) => c.args)).toEqual([[dir]])
  })

  it('falls back with api_error when the model call throws', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('529 overloaded'))
    const out = await run(
      ask,
      fakeDraw(() => ({ code: 0, stalled: false })),
    )
    expect(out).toMatchObject({ used: false, fallbackReason: 'api_error' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toEqual([dir])
  })

  it('falls back with api_error on a refusal or a reply without a code block', async () => {
    for (const r of [reply('no', 'refusal'), reply('```js\nreturn [', 'max_tokens')]) {
      calls = []
      const out = await run(
        vi.fn().mockResolvedValue(r),
        fakeDraw(() => ({ code: 0, stalled: false })),
      )
      expect(out.fallbackReason).toBe('api_error')
    }
  })

  it('uses a longest complete block from a max_tokens reply', async () => {
    const ask = vi
      .fn()
      .mockResolvedValue(reply(`${block('return 1')}\ntrailing\n\`\`\`js\nreturn [`, 'max_tokens'))
    const out = await run(ask, fakeDraw(reportAndSheet(okReport)), { ...config, review: false })
    expect(out).toMatchObject({ used: true, fallbackReason: null })
    expect(readFileSync(path.join(dir, 'director', 'scenes.js'), 'utf8')).toBe('return 1\n')
  })

  it('renders the reviewed script and sums token usage across both calls', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(reply(block('return 1')))
      .mockResolvedValueOnce(reply(block('return 2')))
    const out = await run(ask, fakeDraw(reportAndSheet(okReport)))
    expect(out).toEqual({
      used: true,
      model: 'claude-haiku-5-5',
      scenes: 6,
      sceneErrors: 1,
      fallbackReason: null,
      inputTokens: 20,
      outputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 14,
      ms: 250,
    })
    expect(readFileSync(path.join(dir, 'director', 'scenes.js'), 'utf8')).toBe('return 2\n')
    expect(calls).toHaveLength(2)
    expect(calls[0]!.args).toContain('--review-sheet')
    expect(calls[1]!.args).not.toContain('--review-sheet')
  })

  it('sends the sheet and the scene errors to the review turn', async () => {
    const ask = vi.fn().mockResolvedValue(reply(block('return 1')))
    await run(ask, fakeDraw(reportAndSheet(okReport)))
    const second = ask.mock.calls[1]![1] as { role: string; content: unknown }[]
    const content = second[2]!.content as { type: string; text?: string }[]
    expect(content.map((c) => c.type)).toEqual(['image', 'text'])
    expect(content[1]!.text).toContain('REVIEW')
    expect(content[1]!.text).toContain('scene 2: x')
    expect(ask.mock.calls[0]![0]).toContain('RULES')
  })

  it('keeps the first script when the review call fails', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(reply(block('return 1')))
      .mockRejectedValueOnce(new Error('boom'))
    const out = await run(ask, fakeDraw(reportAndSheet(okReport)))
    expect(out.used).toBe(true)
    expect(readFileSync(path.join(dir, 'director', 'scenes.js'), 'utf8')).toBe('return 1\n')
  })

  it('keeps the first script when the corrected one fails to load', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(reply(block('return 1')))
      .mockResolvedValueOnce(reply(block('return 2')))
    let finals = 0
    const draw = fakeDraw((args) => {
      if (args.includes('--review-sheet')) return reportAndSheet(okReport)(args, dir)
      finals += 1
      if (finals === 1) {
        writeFileSync(
          flagOf(args, 'report'),
          JSON.stringify({ loadError: 'SyntaxError', scenes: 0, sceneErrors: [] }),
        )
        return { code: 3, stalled: false }
      }
      return reportAndSheet(okReport)(args, dir)
    })
    const out = await run(ask, draw)
    expect(out).toMatchObject({ used: true, fallbackReason: null })
    expect(readFileSync(path.join(dir, 'director', 'scenes.js'), 'utf8')).toBe('return 1\n')
  })

  it('falls back with load_error when no script loads', async () => {
    const ask = vi.fn().mockResolvedValue(reply(block('return 1')))
    const broken: DrawReport = { loadError: 'SyntaxError: x', scenes: 0, sceneErrors: [] }
    const draw = fakeDraw((args) => {
      if (args.includes('--scenes')) {
        writeFileSync(flagOf(args, 'report'), JSON.stringify(broken))
        return { code: 3, stalled: false }
      }
      return { code: 0, stalled: false }
    })
    const out = await run(ask, draw)
    expect(out).toMatchObject({ used: false, fallbackReason: 'load_error', scenes: 0 })
    expect(calls.at(-1)!.args).toEqual([dir])
    const review = ask.mock.calls[1]![1] as { content: { type: string; text?: string }[] }[]
    expect(review[2]!.content.map((c) => c.type)).toEqual(['text'])
    expect(review[2]!.content[0]!.text).toContain('FAILED TO LOAD')
  })

  it('falls back with timeout when the child stalls, and with crash when it crashes', async () => {
    const ask = () => vi.fn().mockResolvedValue(reply(block('return 1')))
    const stall = fakeDraw((args) =>
      args.includes('--scenes') ? { code: null, stalled: true } : { code: 0, stalled: false },
    )
    expect((await run(ask(), stall, { ...config, review: false })).fallbackReason).toBe('timeout')
    const crash = fakeDraw((args) => ({ code: args.includes('--scenes') ? 1 : 0, stalled: false }))
    expect((await run(ask(), crash, { ...config, review: false })).fallbackReason).toBe('crash')
  })

  it('throws when the generic fallback render fails too', async () => {
    const draw = fakeDraw(() => ({ code: 1, stalled: false }))
    await expect(run(null, draw)).rejects.toThrow(/generic render failed/)
  })
})
