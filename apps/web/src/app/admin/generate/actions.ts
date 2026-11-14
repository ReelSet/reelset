'use server'

import { z } from 'zod'
import { getDb } from '@/server/db'
import { runAdminAction } from '@/server/admin/run'
import {
  adminGenerate,
  dismissUpgrade,
  grantUpgrade,
  retryRequest,
  setItemVisibility,
} from '@/server/admin/generate'

const idSchema = z.guid()
const visibilitySchema = z.enum(['public', 'private'])

export async function generateAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'generate', ({ adminId, log }) =>
    adminGenerate(getDb(), { adminId, urls: formData.get('urls') }, log),
  )
}

export async function visibilityAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'generate-visibility', async ({ log }) => {
    const itemId = idSchema.safeParse(formData.get('itemId'))
    const visibility = visibilitySchema.safeParse(formData.get('visibility'))
    if (!itemId.success || !visibility.success) return { ok: false, message: 'Invalid request' }
    return setItemVisibility(getDb(), { itemId: itemId.data, visibility: visibility.data }, log)
  })
}

export async function retryRequestAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'generate-retry', async ({ adminId, log }) => {
    const id = idSchema.safeParse(formData.get('requestId'))
    if (!id.success) return { ok: false, message: 'Invalid request id' }
    return retryRequest(getDb(), { requestId: id.data, adminId }, log)
  })
}

export async function grantAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'generate-grant', async ({ log }) => {
    const id = idSchema.safeParse(formData.get('id'))
    if (!id.success) return { ok: false, message: 'Invalid request id' }
    return grantUpgrade(getDb(), { id: id.data, credits: formData.get('credits') }, log)
  })
}

export async function dismissAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'generate-dismiss', async ({ log }) => {
    const id = idSchema.safeParse(formData.get('id'))
    if (!id.success) return { ok: false, message: 'Invalid request id' }
    return dismissUpgrade(getDb(), { id: id.data }, log)
  })
}
