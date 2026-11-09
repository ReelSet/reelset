import { z } from 'zod'
import type { ItemImage, Logger, Source } from '@reelset/core'
import { errorFields } from '@reelset/core'
import { CONTAINER_BASE_URL, RENDER_TIMEOUT_MS, TEMPLATE_VERSION } from './constants'
import { RenderJobError, parseErrorCode } from './errors'
import type { ItemFacts } from './facts'

export type ContainerFetcher = { fetch(request: Request): Promise<Response> }

export type RenderInput = {
  jobId: string
  script: unknown
  title: string
  sourceLabel: string
  imageUrls: string[]
  voice: string
  source: Source | null
  canonicalUrl: string
  sourceImageUrls: string[]
  images: ItemImage[]
  facts?: ItemFacts
  narration?: { audioBase64: string; words: { text: string; start: number; end: number }[] }
}

const metadataSchema = z.object({
  jobId: z.string(),
  bytes: z.number().int().positive(),
  posterBytes: z.number().int().positive(),
  durationMs: z.number().int().positive(),
  ttsDurationMs: z.number().int().nonnegative(),
  ttsChars: z.number().int().nonnegative(),
  renderMs: z.number().int().nonnegative(),
  cover: z.boolean().default(false),
  templateVersion: z.string().optional(),
})
export type RenderMetadata = z.infer<typeof metadataSchema>

export type ContainerClient = {
  render(input: RenderInput): Promise<RenderMetadata>
  download(jobId: string, asset: 'video' | 'poster'): Promise<ArrayBuffer>
  remove(jobId: string): Promise<void>
}

async function send(
  fetcher: ContainerFetcher,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  log: Logger,
): Promise<Response> {
  const method = init.method ?? 'GET'
  try {
    const res = await fetcher.fetch(
      new Request(`${CONTAINER_BASE_URL}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    )
    log.info({ method, path, status: res.status }, 'container call')
    return res
  } catch (err) {
    log.error({ method, path, ...errorFields(err) }, 'container call failed')
    throw new RenderJobError('container_unreachable', `container ${method} ${path} failed`)
  }
}

async function failureFrom(res: Response, what: string): Promise<RenderJobError> {
  const body: unknown = await res.json().catch(() => null)
  const code =
    typeof body === 'object' && body !== null && 'error' in body ? parseErrorCode(body.error) : null
  return new RenderJobError(code ?? 'container_unreachable', `${what} returned ${res.status}`)
}

export function createContainerClient(fetcher: ContainerFetcher, log: Logger): ContainerClient {
  return {
    async render(input) {
      const res = await send(
        fetcher,
        '/render',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, source: input.source ?? undefined }),
        },
        RENDER_TIMEOUT_MS,
        log,
      )
      if (!res.ok) throw await failureFrom(res, 'render')
      const parsed = metadataSchema.safeParse(await res.json().catch(() => null))
      if (!parsed.success) {
        throw new RenderJobError('bad_container_response', 'render metadata did not validate')
      }
      if (parsed.data.templateVersion !== TEMPLATE_VERSION) {
        log.warn(
          { reported: parsed.data.templateVersion ?? null, expected: TEMPLATE_VERSION },
          'container rendered with a different template version, discarding',
        )
        await this.remove(input.jobId)
        throw new RenderJobError(
          'stale_container_template',
          `container template ${parsed.data.templateVersion ?? 'unknown'} != ${TEMPLATE_VERSION}`,
        )
      }
      return parsed.data
    },

    async download(jobId, asset) {
      const res = await send(fetcher, `/render/${jobId}/${asset}`, {}, 60_000, log)
      if (!res.ok) throw await failureFrom(res, `download ${asset}`)
      return res.arrayBuffer()
    },

    async remove(jobId) {
      try {
        await send(fetcher, `/render/${jobId}`, { method: 'DELETE' }, 15_000, log)
      } catch (err) {
        log.warn({ jobId, ...errorFields(err) }, 'container job cleanup failed (it will be reaped)')
      }
    },
  }
}

/** Tries each container slot until one is not busy; later calls for the job reuse that slot. */
export async function renderWithFailover(
  slots: readonly ContainerFetcher[],
  input: RenderInput,
  log: Logger,
): Promise<{ client: ContainerClient; metadata: RenderMetadata }> {
  let lastError: RenderJobError | null = null
  for (const [index, slot] of slots.entries()) {
    const client = createContainerClient(slot, log.child({ slot: index }))
    try {
      return { client, metadata: await client.render(input) }
    } catch (err) {
      if (err instanceof RenderJobError && err.code === 'busy') {
        log.info({ slot: index }, 'container slot busy, trying next')
        lastError = err
        continue
      }
      throw err
    }
  }
  throw lastError ?? new RenderJobError('busy', 'no container slots configured')
}
