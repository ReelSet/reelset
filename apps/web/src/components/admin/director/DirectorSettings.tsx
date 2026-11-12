import { resetDirectorSettingAction, saveDirectorSettingAction } from '@/app/admin/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button, buttonPrimary, input } from '@/components/admin/ui'
import type { DirectorSettingField } from '@/lib/admin/director'

const BOOLEANS = ['true', 'false'] as const
const TEXT_ROWS = { directorRules: 22, directorReviewPrompt: 8 } as const

function Control({ field, value }: { field: DirectorSettingField; value: string }) {
  if (field.kind === 'boolean' || field.kind === 'enum') {
    const options = field.kind === 'boolean' ? BOOLEANS : field.options
    return (
      <select
        name="value"
        aria-label={field.label}
        defaultValue={value}
        className={`${input} w-48 font-mono text-xs`}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.kind === 'number') {
    return (
      <input
        name="value"
        aria-label={field.label}
        defaultValue={value}
        inputMode="numeric"
        className={`${input} w-40 font-mono text-xs`}
      />
    )
  }
  const rows = TEXT_ROWS[field.name as keyof typeof TEXT_ROWS] ?? 8
  return (
    <textarea
      name="value"
      aria-label={field.label}
      defaultValue={value}
      rows={rows}
      spellCheck={false}
      className={`${input} w-full font-mono text-xs leading-relaxed`}
    />
  )
}

export function DirectorSettingForm({
  field,
  value,
  isDefault,
}: {
  field: DirectorSettingField
  value: string
  isDefault: boolean
}) {
  return (
    <form
      action={saveDirectorSettingAction}
      className="rounded-md border border-line bg-surface p-4"
    >
      <input type="hidden" name="name" value={field.name} />
      <input type="hidden" name="returnTo" value="/admin/director" />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <label className="text-[13px] font-medium">{field.label}</label>
        <span className="font-mono text-[11px] text-faint">
          {field.def.key}
          {isDefault ? ' (default)' : ' (customised)'}
        </span>
      </div>
      <p className="mb-2 text-xs text-faint">{field.hint}</p>
      <Control field={field} value={value} />
      <div className="mt-3 flex items-center gap-2">
        <SubmitButton className={buttonPrimary} pendingLabel="Saving">
          Save
        </SubmitButton>
        <SubmitButton
          className={button}
          pendingLabel="Resetting"
          formAction={resetDirectorSettingAction}
          confirm={`Reset ${field.def.key} to its default?`}
        >
          Reset to default
        </SubmitButton>
      </div>
    </form>
  )
}
