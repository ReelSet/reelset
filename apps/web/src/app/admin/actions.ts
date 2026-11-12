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
import {
  createDirectorSkill,
  moveDirectorSkill,
  removeDirectorSkill,
  resetDirectorSetting,
  saveDirectorSetting,
  saveDirectorSkill,
  toggleDirectorSkill,
} from '@/server/admin/director'

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

const text = (formData: FormData, key: string) => formData.get(key)

export async function saveDirectorSettingAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'save-director-setting', async ({ log }) =>
    saveDirectorSetting(
      getDb(),
      { name: text(formData, 'name'), raw: text(formData, 'value') },
      log,
    ),
  )
}

export async function resetDirectorSettingAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'reset-director-setting', async ({ log }) =>
    resetDirectorSetting(getDb(), { name: text(formData, 'name') }, log),
  )
}

export async function createDirectorSkillAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'create-director-skill', async ({ log }) =>
    createDirectorSkill(
      getDb(),
      {
        name: text(formData, 'name'),
        kind: text(formData, 'kind'),
        content: text(formData, 'content'),
      },
      log,
    ),
  )
}

export async function saveDirectorSkillAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'save-director-skill', async ({ log }) => {
    const id = idSchema.safeParse({ id: formData.get('id') })
    if (!id.success) return { ok: false, message: 'Invalid skill id' }
    return saveDirectorSkill(
      getDb(),
      {
        id: id.data.id,
        name: text(formData, 'name'),
        kind: text(formData, 'kind'),
        content: text(formData, 'content'),
      },
      log,
    )
  })
}

export async function toggleDirectorSkillAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'toggle-director-skill', async ({ log }) => {
    const id = idSchema.safeParse({ id: formData.get('id') })
    if (!id.success) return { ok: false, message: 'Invalid skill id' }
    return toggleDirectorSkill(
      getDb(),
      { id: id.data.id, enabled: formData.get('enabled') === 'true' },
      log,
    )
  })
}

export async function moveDirectorSkillAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'move-director-skill', async ({ log }) => {
    const id = idSchema.safeParse({ id: formData.get('id') })
    const direction = formData.get('direction')
    if (!id.success || (direction !== 'up' && direction !== 'down')) {
      return { ok: false, message: 'Invalid move request' }
    }
    return moveDirectorSkill(getDb(), { id: id.data.id, direction }, log)
  })
}

export async function deleteDirectorSkillAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'delete-director-skill', async ({ log }) => {
    const id = idSchema.safeParse({ id: formData.get('id') })
    if (!id.success) return { ok: false, message: 'Invalid skill id' }
    return removeDirectorSkill(getDb(), { id: id.data.id }, log)
  })
}
