'use server'

import { z } from 'zod'
import { getDb } from '@/server/db'
import { runAdminAction } from '@/server/admin/run'
import { grantUserCredits } from '@/server/admin/users'

export async function grantCreditsAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'users-grant', async ({ log }) => {
    const userId = z.guid().safeParse(formData.get('userId'))
    if (!userId.success) return { ok: false, message: 'Invalid user id' }
    return grantUserCredits(getDb(), { userId: userId.data, credits: formData.get('credits') }, log)
  })
}
