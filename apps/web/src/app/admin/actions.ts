'use server'

import { errorFields } from '@reelset/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { idSchema, itemRetrySchema, safeAdminPath, withFlash } from '@/lib/admin/retry'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { assertAdmin } from '@/server/admin/guard'
import {
  discardItem,
  retryIngestTask,
  retryItem,
  retryRender,
  saveSetting,
  type CommandResult,
} from '@/server/admin/commands'

async function run(
  formData: FormData,
  action: string,
  exec: (ctx: { adminId: string; log: ReturnType<typeof routeLog> }) => Promise<CommandResult>,
): Promise<never> {
  const returnTo = safeAdminPath(formData.get('returnTo'))
  const log = routeLog(`admin/${action}`)
  const admin = await assertAdmin()

  let result: CommandResult
  try {
    result = await exec({ adminId: admin.id, log: log.child({ adminId: admin.id }) })
  } catch (err) {
    log.error(errorFields(err), 'admin action failed')
    result = { ok: false, message: 'Action failed, see server logs' }
  }
  log.info({ ok: result.ok, adminId: admin.id }, 'admin action finished')
  revalidatePath('/admin', 'layout')
  redirect(withFlash(returnTo, result.ok ? 'ok' : 'error', result.message))
}

export async function retryItemAction(formData: FormData): Promise<void> {
  await run(formData, 'retry-item', async ({ adminId, log }) => {
    const parsed = itemRetrySchema.safeParse({
      itemId: formData.get('itemId'),
      stage: formData.get('stage'),
    })
    if (!parsed.success) return { ok: false, message: 'Invalid retry request' }
    return retryItem(getDb(), { ...parsed.data, adminId }, log)
  })
}

export async function discardItemAction(formData: FormData): Promise<void> {
  await run(formData, 'discard-item', async ({ adminId, log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid item id' }
    return discardItem(getDb(), { itemId: parsed.data.id, adminId }, log)
  })
}

export async function retryRenderAction(formData: FormData): Promise<void> {
  await run(formData, 'retry-render', async ({ adminId, log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid render id' }
    return retryRender(getDb(), { renderId: parsed.data.id, adminId }, log)
  })
}

export async function retryTaskAction(formData: FormData): Promise<void> {
  await run(formData, 'retry-task', async ({ log }) => {
    const parsed = idSchema.safeParse({ id: formData.get('id') })
    if (!parsed.success) return { ok: false, message: 'Invalid task id' }
    return retryIngestTask(getDb(), { taskId: parsed.data.id }, log)
  })
}

export async function saveSettingAction(formData: FormData): Promise<void> {
  await run(formData, 'save-setting', async ({ log }) => {
    const name = formData.get('name')
    if (typeof name !== 'string') return { ok: false, message: 'Invalid setting' }
    return saveSetting(getDb(), { name, raw: formData.get('value') }, log)
  })
}
