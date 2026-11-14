'use server'

import { setIgCheckError } from '@reelset/core'
import { z } from 'zod'
import { accountFlash, parseConnectForm } from '@/lib/instagram/account'
import {
  checkInstagramAccount,
  connectInstagramAccount,
  disconnectInstagramAccount,
  kickInstagramQueue,
  workerConfigFromEnv,
} from '@/lib/instagram/worker-client'
import { getDb } from '@/server/db'
import { runAdminAction } from '@/server/admin/run'
import { cancelQueuedPost, queueInstagramPost, requestPostDelete } from '@/server/admin/instagram'

const postIdSchema = z.guid()
const NO_WORKER = {
  ok: false,
  message: 'Poster is not configured (IG_ADMIN_URL / IG_ADMIN_TOKEN)',
} as const

export async function queuePostAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-queue', async ({ adminId, log }) => {
    const result = await queueInstagramPost(
      getDb(),
      {
        itemId: formData.get('itemId'),
        videoKey: formData.get('videoKey'),
        caption: formData.get('caption'),
        adminId,
      },
      log,
    )
    const worker = workerConfigFromEnv()
    if (result.ok && worker) await kickInstagramQueue(worker)
    return result
  })
}

export async function cancelPostAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-cancel', async ({ log }) => {
    const id = postIdSchema.safeParse(formData.get('postId'))
    if (!id.success) return { ok: false, message: 'Invalid post id' }
    return cancelQueuedPost(getDb(), { postId: id.data }, log)
  })
}

export async function deletePostAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-delete', async ({ log }) => {
    const id = postIdSchema.safeParse(formData.get('postId'))
    if (!id.success) return { ok: false, message: 'Invalid post id' }
    const result = await requestPostDelete(getDb(), { postId: id.data }, log)
    const worker = workerConfigFromEnv()
    if (result.ok && worker) await kickInstagramQueue(worker)
    return result
  })
}

async function rememberCheck(
  result: { ok: true } | { ok: false; message: string },
  log: { warn: (o: object, m: string) => void },
): Promise<void> {
  const error = result.ok ? null : { message: result.message, at: new Date().toISOString() }
  if (error) log.warn({ reason: error.message }, 'instagram account call failed')
  await setIgCheckError(getDb(), error)
}

export async function checkAccountAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-check', async ({ log }) => {
    const worker = workerConfigFromEnv()
    if (!worker) return NO_WORKER
    const result = await checkInstagramAccount(worker)
    await rememberCheck(result, log)
    return result.ok ? accountFlash(result.value) : { ok: false, message: result.message }
  })
}

export async function connectAccountAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-connect', async ({ log }) => {
    const worker = workerConfigFromEnv()
    if (!worker) return NO_WORKER
    const form = parseConnectForm(formData)
    if (!form.ok) return { ok: false, message: form.message }
    log.info({ newCreds: Boolean(form.value.username), code: Boolean(form.value.code) }, 'connect')
    const result = await connectInstagramAccount(worker, form.value)
    await rememberCheck(result, log)
    return result.ok ? accountFlash(result.value) : { ok: false, message: result.message }
  })
}

export async function disconnectAccountAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-disconnect', async ({ log }) => {
    const worker = workerConfigFromEnv()
    if (!worker) return NO_WORKER
    const result = await disconnectInstagramAccount(worker)
    await rememberCheck(result, log)
    if (!result.ok) return { ok: false, message: result.message }
    log.info('instagram account disconnected')
    return { ok: true, message: 'Disconnected. Saved session and credentials are gone.' }
  })
}
