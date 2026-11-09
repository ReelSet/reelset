import { StaleTransitionError, errorFields, type Logger } from '@reelset/core'
import { z } from 'zod'
import { decideOnError, retryDelaySeconds } from './decide'
import { failItemAfterRetries, processItem, releaseItem, type ProcessDeps } from './process'
import { QuotaExhaustedError, pauseForQuota } from './quota'

export type MessageLike = {
  id: string
  body: unknown
  attempts: number
  ack: () => void
  retry: (options?: { delaySeconds?: number }) => void
}

const bodySchema = z.object({ itemId: z.uuid(), attempt: z.number().int().min(0) })

export type MessageResult = 'acked' | 'retried' | 'failed' | 'poison' | 'paused'

export async function handleMessage(
  deps: ProcessDeps,
  message: MessageLike,
): Promise<MessageResult> {
  const log: Logger = deps.log.child({ messageId: message.id, deliveryAttempt: message.attempts })
  const body = bodySchema.safeParse(message.body)
  if (!body.success) {
    log.error({ issues: body.error.issues.length }, 'invalid ingest-items message body, acking')
    message.ack()
    return 'poison'
  }
  const { itemId } = body.data

  try {
    const outcome = await processItem({ ...deps, log }, itemId, message.attempts)
    log.info({ itemId, outcome }, 'message processed')
    message.ack()
    return 'acked'
  } catch (err) {
    if (err instanceof StaleTransitionError) {
      log.info({ itemId }, 'duplicate or stale delivery, acking')
      message.ack()
      return 'acked'
    }

    if (err instanceof QuotaExhaustedError) {
      log.error({ itemId, status: err.status }, 'llm quota exhausted, pausing pipeline')
      await pauseForQuota(deps.db, deps.alertWebhookUrl, err, log)
      await releaseItem(deps.db, itemId)
      message.ack()
      return 'paused'
    }

    log.error({ itemId, ...errorFields(err) }, 'message processing failed')
    if (decideOnError(message.attempts) === 'fail') {
      await failItemAfterRetries({ db: deps.db, log }, itemId, message.attempts, err)
      message.ack()
      return 'failed'
    }
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
    return 'retried'
  }
}
