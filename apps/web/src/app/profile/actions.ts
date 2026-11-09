'use server'

import { revalidatePath } from 'next/cache'
import { UnauthorizedError, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { saveSources, saveTopics } from '@/server/preferences'

export type ActionResult =
  { ok: true } | { ok: false; error: 'invalid' | 'unauthorized' | 'failed' }

async function run(
  name: string,
  save: (profileId: string, log: ReturnType<typeof routeLog>) => Promise<{ ok: boolean }>,
): Promise<ActionResult> {
  const log = routeLog(`profile/${name}`)
  try {
    const user = await requireUser('/profile')
    const result = await save(user.id, log)
    if (!result.ok) return { ok: false, error: 'invalid' }
    revalidatePath('/profile')
    return { ok: true }
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: 'unauthorized' }
    return { ok: false, error: 'failed' }
  }
}

export async function updateTopics(topics: string[]): Promise<ActionResult> {
  return run('topics', (id, log) => saveTopics(getDb(), id, { topics }, log))
}

export async function updateSources(sources: string[]): Promise<ActionResult> {
  return run('sources', (id, log) => saveSources(getDb(), id, { sources }, log))
}
