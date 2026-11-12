import type { SettingField } from '@/lib/admin/settings-form'
import { input } from '@/components/admin/ui'

const MAX_LIST_ROWS = 8
const MIN_LIST_ROWS = 2

const BOOLEAN_OPTIONS = ['true', 'false'] as const

/** The `value` form control for one setting: select for enums and booleans, textarea for lists, else a number. */
export function SettingValueInput({ field, text }: { field: SettingField; text: string }) {
  if (field.kind === 'enum' || field.kind === 'boolean') {
    const options = field.kind === 'enum' ? field.options : BOOLEAN_OPTIONS
    return (
      <select
        name="value"
        aria-label={field.def.key}
        defaultValue={text}
        className={`${input} w-48 font-mono text-xs`}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    )
  }
  if (field.kind === 'list') {
    const rows = Math.min(MAX_LIST_ROWS, Math.max(MIN_LIST_ROWS, text.split('\n').length))
    return (
      <textarea
        name="value"
        aria-label={field.def.key}
        defaultValue={text}
        rows={rows}
        className={`${input} w-96 font-mono text-xs`}
      />
    )
  }
  return (
    <input
      name="value"
      aria-label={field.def.key}
      defaultValue={text}
      inputMode="decimal"
      className={`${input} w-32`}
    />
  )
}
