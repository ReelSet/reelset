'use client'

import { useActionState } from 'react'
import { resetGateSettingAction, saveGateSettingsAction } from '@/app/admin/(pipeline)/gate/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button, buttonPrimary } from '@/components/admin/primitives'
import { ADMIN_ROUTES } from '@/lib/admin/nav'

type Props = {
  title: string
  settingKeys: string
  isDefault: boolean
  hint: string
  confirm?: string
  reset?: { name: string; label: string }
  actions?: React.ReactNode
  children: React.ReactNode
}

function ResetForm({ name, label }: { name: string; label: string }) {
  return (
    <form action={resetGateSettingAction}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="returnTo" value={ADMIN_ROUTES.gateSettings} />
      <SubmitButton className={button} pendingLabel="Resetting" confirm={`${label}?`}>
        {label}
      </SubmitButton>
    </form>
  )
}

/** One gate setting group: a save that redirects with a toast on success and reports a validation error in place, keeping what was typed. */
export function GateSettingsCard({
  title,
  settingKeys,
  isDefault,
  hint,
  confirm,
  reset,
  actions,
  children,
}: Props) {
  const [state, save] = useActionState(saveGateSettingsAction, null)
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium">{title}</h3>
        <span className="font-mono text-[11px] text-faint">
          {settingKeys}
          {isDefault ? ' (default)' : ' (customised)'}
        </span>
      </div>
      <p className="mb-3 text-xs text-faint">{hint}</p>
      <form action={save}>
        <input type="hidden" name="returnTo" value={ADMIN_ROUTES.gateSettings} />
        {children}
        {state ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            Not saved. {state.message}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SubmitButton className={buttonPrimary} pendingLabel="Saving" confirm={confirm}>
            Save
          </SubmitButton>
          {actions}
        </div>
      </form>
      {reset ? (
        <div className="mt-2">
          <ResetForm {...reset} />
        </div>
      ) : null}
    </section>
  )
}
