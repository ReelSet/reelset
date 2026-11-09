import { vi } from 'vitest'
import { createLogger } from '@reelset/core'
import { httpTuning } from '../../src/http'

export const testLog = createLogger({ app: 'test', level: 'silent' })

export type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status })
}

export function useFetch(...routes: Route[]) {
  httpTuning.backoffScale = 0
  httpTuning.hostIntervalScale = 0
  const calls: string[] = []
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    for (const route of routes) {
      const res = await route(url, init)
      if (res) return res
    }
    return new Response('no route', { status: 599 })
  })
  vi.stubGlobal('fetch', mock)
  return { calls, mock }
}
