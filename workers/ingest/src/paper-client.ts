import { errorFields, parsedPaperSchema, type Logger, type ParsedPaper } from '@reelset/core'
import { z } from 'zod'
import { PAPER_PARSE_TIMEOUT_MS } from './config'

const PARSE_URL = 'https://render.internal/parse/paper'

const responseSchema = z.looseObject({
  status: z.enum(['ok', 'failed']),
  paper: parsedPaperSchema.optional(),
  cached: z.boolean().optional(),
})

export type PaperClient = {
  /** The parsed paper, or null when it could not be parsed or the service is unreachable. */
  parse: (arxivId: string) => Promise<ParsedPaper | null>
}

export function arxivIdFromKey(canonicalKey: string): string | null {
  return canonicalKey.startsWith('arxiv:') ? canonicalKey.slice('arxiv:'.length) : null
}

export function createPaperClient(
  fetcher: Pick<Fetcher, 'fetch'>,
  log: Logger,
  timeoutMs = PAPER_PARSE_TIMEOUT_MS,
): PaperClient {
  return {
    parse: async (arxivId) => {
      const startedAt = performance.now()
      try {
        const res = await fetcher.fetch(PARSE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ arxivId }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const body = responseSchema.safeParse(await res.json().catch(() => null))
        const paper = body.success && body.data.status === 'ok' ? (body.data.paper ?? null) : null
        log.info(
          {
            arxivId,
            httpStatus: res.status,
            parsed: paper !== null,
            source: paper?.source,
            tables: paper?.tables.length,
            figures: paper?.figures.length,
            hires: paper?.figures.filter((f) => f.hires).length,
            cached: body.success ? body.data.cached : undefined,
            durationMs: Math.round(performance.now() - startedAt),
          },
          'paper parse service responded',
        )
        return paper
      } catch (err) {
        log.warn({ arxivId, ...errorFields(err) }, 'paper parse unavailable, using plain text')
        return null
      }
    },
  }
}

export const noPaperClient: PaperClient = { parse: async () => null }
