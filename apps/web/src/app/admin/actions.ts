'use server'

import { idSchema, itemRetrySchema } from '@/lib/admin/retry'
import { getDb } from '@/server/db'
import { runAdminAction } from '@/server/admin/run'
import {
  discardItem,
  retryIngestTask,
  retryItem,
  retryRender,
  saveSetting,
} from '@/server/admin/commands'

export async function retryItemAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'retry-item', async ({ adminId, log }) => {
    const parsed = itemRetrySchema.safeParse({
      itemId: formData.get('itemId'),
      stage: formData.get('stage'),
    })
    if (!parsed.success) return { ok: false, message: 'Invalid retry request' }
    return retryItem(getDb(), { ...parsed.data, adminId }, log)
  })
}

export async function discardItemAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'discard-item', async ({ adminId, log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid item id' }
    return discardItem(getDb(), { itemId: parsed.data.id, adminId }, log)
  })
}

export async function retryRenderAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'retry-render', async ({ adminId, log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid render id' }
    return retryRender(getDb(), { renderId: parsed.data.id, adminId }, log)
  })
}

export async function retryTaskAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'retry-task', async ({ log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid task id' }
    return retryIngestTask(getDb(), { taskId: parsed.data.id }, log)
  })
}

export async function saveSettingAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'save-setting', async ({ log }) => {
    const name = formData.get('name')
    if (typeof name !== 'string') return { ok: false, message: 'Invalid setting' }
    return saveSetting(getDb(), { name, raw: formData.get('value') }, log)
  })
}
