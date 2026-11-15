'use client'

import { useState } from 'react'
import { input } from '@/components/admin/primitives'
import { GATE_FIELD } from '@/lib/admin/gate-fields'
import { GateSettingsCard } from './GateSettingsCard'

const ROWS = 22

type Props = { saved: string; minChars: number; maxChars: number; isDefault: boolean }

/** The judge's instructions as one long text; a rejected save keeps the typed text in place. */
export function InstructionsCard({ saved, minChars, maxChars, isDefault }: Props) {
  const [text, setText] = useState(saved)
  const length = text.trim().length
  const outOfRange = length < minChars || length > maxChars
  return (
    <GateSettingsCard
      title="Judge instructions"
      settingKeys="gate_instructions"
      isDefault={isDefault}
      hint={`What the judge is told about the audience and what makes a reel worth making, ${minChars} to ${maxChars} characters. Your agree and disagree labels are added after it as examples.`}
      reset={{ name: 'instructions', label: 'Reset to default' }}
    >
      <textarea
        name={GATE_FIELD.instructions}
        aria-label="Judge instructions"
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={ROWS}
        spellCheck={false}
        className={`${input} w-full font-mono text-xs leading-relaxed`}
      />
      <p
        className={`mt-1 text-right text-[11px] tabular-nums ${outOfRange ? 'text-warn' : 'text-faint'}`}
      >
        {length.toLocaleString('en-US')} / {maxChars.toLocaleString('en-US')} characters
      </p>
    </GateSettingsCard>
  )
}
