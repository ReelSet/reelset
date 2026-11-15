'use client'

import { input } from '@/components/admin/primitives'

type NumberProps = {
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
}

/** A number box, controlled so a failed save never loses what was typed. */
export function NumberInput({ name, label, value, onChange, min, max }: NumberProps) {
  return (
    <input
      type="number"
      name={name}
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step="any"
      inputMode="decimal"
      onChange={(event) => onChange(event.target.value)}
      className={`${input} w-24 font-mono text-xs tabular-nums`}
    />
  )
}

/** A range slider and a number box bound to the same value; only the number box is submitted. */
export function SliderNumber({ step, ...props }: NumberProps & { step: number }) {
  const { label, value, onChange, min, max } = props
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={`${label} slider`}
        value={value === '' ? min : value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="h-1 min-w-0 flex-1 accent-accent"
      />
      <NumberInput {...props} />
    </div>
  )
}

export function Select({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
}) {
  return (
    <select
      name={name}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${input} font-mono text-xs`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** A labelled control with one plain sentence about what it does. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5 border-t border-line/60 py-3 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center md:gap-4">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        <p className="text-xs text-faint">{hint}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
