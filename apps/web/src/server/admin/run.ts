import { errorFields } from '@reelset/core'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { safeAdminPath, withFlash } from '@/lib/admin/retry'
import { assertAdmin } from '@/server/admin/guard'
import type { CommandResult } from '@/server/admin/commands'
import { routeLog } from '@/server/logger'

type AdminExec = (ctx: {
  adminId: string
  log: ReturnType<typeof routeLog>
}) => Promise<CommandResult>

async function execAsAdmin(action: string, exec: AdminExec): Promise<CommandResult> {
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
  return result
}

function redirectWithFlash(formData: FormData, result: CommandResult): never {
  revalidatePath('/admin', 'layout')
  const returnTo = safeAdminPath(formData.get('returnTo'))
  redirect(withFlash(returnTo, result.ok ? 'ok' : 'error', result.message))
}

// Shared wrapper for admin form actions: auth, error containment, flash redirect.
export async function runAdminAction(
  formData: FormData,
  action: string,
  exec: AdminExec,
): Promise<never> {
  redirectWithFlash(formData, await execAsAdmin(action, exec))
}

export type AdminFormState = { ok: false; message: string } | null

// For useActionState forms: a failure is returned, not redirected, so what the admin typed stays on screen.
export async function runAdminFormAction(
  formData: FormData,
  action: string,
  exec: AdminExec,
): Promise<AdminFormState> {
  const result = await execAsAdmin(action, exec)
  if (!result.ok) return { ok: false, message: result.message }
  redirectWithFlash(formData, result)
}
