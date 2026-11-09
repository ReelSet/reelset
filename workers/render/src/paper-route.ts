import { z } from 'zod'
import {
  PAPER_PARSER_VERSION,
  errorFields,
  paperFigureSchema,
  parsedPaperSchema,
  type Logger,
  type ParsedPaper,
} from '@reelset/core'
import { CONTAINER_BASE_URL, PAPER_PARSE_TIMEOUT_MS } from './constants'
import type { ContainerFetcher } from './container-client'

const requestSchema = z.object({
  arxivId: z.string().regex(/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/),
})

const containerFigure = paperFigureSchema.partial({ url: true }).extend({
  data: z.string().optional(),
  ext: z.enum(['png', 'jpg']).optional(),
})

const containerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    paper: parsedPaperSchema.omit({ figures: true }).extend({ figures: z.array(containerFigure) }),
    stats: z.record(z.string(), z.unknown()),
  }),
  z.object({ status: z.literal('failed'), stats: z.record(z.string(), z.unknown()).optional() }),
])

export const paperKeys = (id: string) => ({
  json: `papers/${id}/paper.json`,
  figure: (i: number, ext: string) => `papers/${id}/fig-${i + 1}.${ext}`,
})

const baseId = (id: string) => id.replace(/v\d+$/, '')
const keyId = (id: string) => id.replace('/', '_')

type PaperDeps = { media: R2Bucket; publicBase: string; container: ContainerFetcher; log: Logger }

async function readCached(media: R2Bucket, id: string): Promise<ParsedPaper | null> {
  const obj = await media.get(paperKeys(keyId(id)).json)
  if (!obj) return null
  const parsed = parsedPaperSchema.safeParse(await obj.json().catch(() => null))
  return parsed.success && parsed.data.version === PAPER_PARSER_VERSION ? parsed.data : null
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Parses an arXiv paper in the container, stores figures and the parsed JSON in R2 under papers/<id>/. */
export async function handleParsePaper(request: Request, deps: PaperDeps): Promise<Response> {
  const body = requestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid arxivId' }, { status: 400 })
  const id = baseId(body.data.arxivId)
  const log = deps.log.child({ arxivId: id })
  const fail = (reason: string, status = 200) =>
    Response.json({ status: 'failed', reason }, { status })

  try {
    const cached = await readCached(deps.media, id)
    if (cached) {
      log.info('paper served from R2')
      return Response.json({ status: 'ok', paper: cached, cached: true })
    }

    const res = await deps.container.fetch(
      new Request(`${CONTAINER_BASE_URL}/parse/paper`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ arxivId: id }),
        signal: AbortSignal.timeout(PAPER_PARSE_TIMEOUT_MS),
      }),
    )
    if (!res.ok) {
      log.warn({ status: res.status }, 'container paper parse returned an error')
      return fail('container_error', 502)
    }
    const parsed = containerSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) {
      log.error('container paper response did not validate')
      return fail('bad_response', 502)
    }
    if (parsed.data.status === 'failed') {
      log.warn({ stats: parsed.data.stats }, 'paper not parseable')
      return fail('not_parseable')
    }

    const { paper, stats } = parsed.data
    const figures: ParsedPaper['figures'] = []
    for (const [i, fig] of paper.figures.entries()) {
      let url = fig.url
      if (fig.data && fig.ext) {
        const key = paperKeys(keyId(id)).figure(i, fig.ext)
        await deps.media.put(key, decode(fig.data), {
          httpMetadata: {
            contentType: fig.ext === 'png' ? 'image/png' : 'image/jpeg',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        })
        url = `${deps.publicBase}/${key}`
      }
      if (!url) continue
      const { data: _data, ext: _ext, ...rest } = fig
      figures.push({ ...rest, url })
    }
    const stored: ParsedPaper = { ...paper, figures }
    await deps.media.put(paperKeys(keyId(id)).json, JSON.stringify(stored), {
      httpMetadata: { contentType: 'application/json' },
    })
    log.info(
      { ...stats, figures: figures.length, hires: figures.filter((f) => f.hires).length },
      'paper parsed and stored',
    )
    return Response.json({ status: 'ok', paper: stored, stats })
  } catch (err) {
    log.error(errorFields(err), 'paper parse failed')
    return fail('exception', 502)
  }
}
