import { errorFields } from '@reelset/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { safeAdminPath, withFlash } from '@/lib/admin/retry'
import { assertAdmin } from '@/server/admin/guard'
import type { CommandResult } from '@/server/admin/commands'
import { routeLog } from '@/server/logger'

// Shared wrapper for admin form actions: auth, error containment, flash redirect.
export async function runAdminAction(
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
