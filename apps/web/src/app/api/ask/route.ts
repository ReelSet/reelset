import { errorFields } from '@reelset/core'
import { z } from 'zod'
import type { AskResponse, AskStreamEvent } from '@/lib/api-types'
import { validateQuestion } from '@/lib/ask/question'
import { ERROR_MESSAGE, runAsk } from '@/lib/ask/service'
import { authErrorResponse, requireUser } from '@/server/auth'
import { createAskDeps } from '@/server/ask-deps'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'
import { resolveRelatedReels } from '@/server/related-reels'
import { routeLog } from '@/server/logger'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ question: z.unknown(), conversationId: z.guid().optional() })

export async function POST(request: Request) {
  const log = routeLog('api/ask')
  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'invalid_body' }, { status: 400 })

  const check = validateQuestion(body.data.question)
  if (!check.ok) {
    log.info({ reason: check.reason }, 'question rejected')
    return Response.json({ error: 'invalid_question', reason: check.reason }, { status: 400 })
  }

  let userId: string
  try {
    userId = (await requireUser('/ask')).id
  } catch (err) {
    const authResponse = authErrorResponse(err)
    if (authResponse) return authResponse
    log.error(errorFields(err), 'ask auth failed')
    return Response.json({ error: 'internal' }, { status: 500 })
  }

  const encoder = new TextEncoder()
  let clientGone = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskStreamEvent) => {
        if (clientGone) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          clientGone = true
        }
      }
      try {
        const result = await runAsk(
          createAskDeps(log),
          { profileId: userId, check, conversationId: body.data.conversationId },
          (text) => send({ type: 'delta', text }),
        )
        const final: AskResponse =
          result.outcome === 'answered'
            ? {
                ...result,
                reels: await resolveRelatedReels(getDb(), result.citations, mediaBaseUrl(), log),
              }
            : result
        send({ type: 'result', result: final })
      } catch (err) {
        log.error(errorFields(err), 'ask route failed')
        send({ type: 'result', result: { outcome: 'error', message: ERROR_MESSAGE } })
      } finally {
        try {
          controller.close()
        } catch {
          clientGone = true
        }
      }
    },
    cancel() {
      clientGone = true
      log.info('ask client disconnected')
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
