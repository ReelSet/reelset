import { spawn } from 'node:child_process'
import { log } from '../engine/log'

export const STALL_MS = 120_000
const ENV_PASSTHROUGH = ['PATH', 'LANG', 'TMPDIR', 'SKIA_ASSETS', 'X264_PRESET'] as const

/** The only environment the drawing child sees: no tokens, keys or credentials. */
export function scrubbedEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: '/tmp' }
  for (const name of ENV_PASSTHROUGH) if (parent[name] !== undefined) env[name] = parent[name]
  return env
}

export type ChildOutcome = { code: number | null; stalled: boolean }
export type DrawChild = (args: string[]) => Promise<ChildOutcome>

type ChildOptions = {
  script: string
  env: NodeJS.ProcessEnv
  stallMs?: number
  forward?: (line: string) => void
}

/** Runs dist/draw.mjs; kills it when it prints nothing for `stallMs`. */
export function createDrawChild(opts: ChildOptions): DrawChild {
  const stallMs = opts.stallMs ?? STALL_MS
  return (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [opts.script, ...args], {
        env: opts.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stalled = false
      let timer = setTimeout(onStall, stallMs)
      function onStall(): void {
        stalled = true
        log.warn({ stallMs }, 'drawing child stalled, killing')
        child.kill('SIGKILL')
      }
      const beat = (): void => {
        clearTimeout(timer)
        timer = setTimeout(onStall, stallMs)
      }
      let pending = ''
      child.stdout.on('data', (chunk: Buffer) => {
        beat()
        const lines = (pending + chunk.toString()).split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) opts.forward?.(line)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        beat()
        process.stderr.write(chunk)
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        log.error({ err: err.message }, 'drawing child could not start')
        resolve({ code: null, stalled: false })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (pending) opts.forward?.(pending)
        resolve({ code, stalled })
      })
    })
}
