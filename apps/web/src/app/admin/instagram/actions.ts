'use server'

import { z } from 'zod'
import { accountFlash } from '@/lib/instagram/account'
import {
  checkInstagramAccount,
  connectInstagramAccount,
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
      { itemId: formData.get('itemId'), caption: formData.get('caption'), adminId },
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

export async function checkAccountAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-check', async () => {
    const worker = workerConfigFromEnv()
    if (!worker) return NO_WORKER
    const result = await checkInstagramAccount(worker)
    return result.ok ? accountFlash(result.value) : { ok: false, message: result.message }
  })
}

const codeSchema = z.string().regex(/^\d{6,8}$/)

export async function connectAccountAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'instagram-connect', async () => {
    const worker = workerConfigFromEnv()
    if (!worker) return NO_WORKER
    const raw = String(formData.get('code') ?? '').replace(/\s+/g, '')
    const code = raw ? codeSchema.safeParse(raw) : null
    if (code && !code.success) return { ok: false, message: 'The 2FA code is 6 digits' }
    const result = await connectInstagramAccount(worker, code?.data)
    return result.ok ? accountFlash(result.value) : { ok: false, message: result.message }
  })
}
