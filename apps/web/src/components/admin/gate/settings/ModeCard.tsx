'use client'

import type { GateMode } from '@reelset/core'
import { useState } from 'react'
import { GATE_FIELD } from '@/lib/admin/gate-fields'
import { GATE_MODE_COPY } from '@/lib/admin/gate-view'
import { GateSettingsCard } from './GateSettingsCard'

const MODES = Object.keys(GATE_MODE_COPY) as GateMode[]
const LIVE_CONFIRM =
  'Switch the gate to Live? Items it judges source only will stop becoming reels.'

/** Off, Shadow or Live, each with what it does; going live asks for confirmation. */
export function ModeCard({ saved, isDefault }: { saved: GateMode; isDefault: boolean }) {
  const [mode, setMode] = useState(saved)
  return (
    <GateSettingsCard
      title="Mode"
      settingKeys="gate_mode"
      isDefault={isDefault}
      hint="Start in Shadow, review the decisions, then go Live once you agree with most of them."
      confirm={mode === 'live' && saved !== 'live' ? LIVE_CONFIRM : undefined}
    >
      <div role="radiogroup" aria-label="Gate mode" className="grid gap-2 md:grid-cols-3">
        {MODES.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer gap-2.5 rounded-md border p-3 transition ${
              option === mode ? 'border-line-strong bg-raised' : 'border-line hover:bg-raised/60'
            }`}
          >
            <input
              type="radio"
              name={GATE_FIELD.mode}
              value={option}
              checked={option === mode}
              onChange={() => setMode(option)}
              className="mt-0.5 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{GATE_MODE_COPY[option].label}</span>
              <span className="block text-xs text-faint">{GATE_MODE_COPY[option].sentence}</span>
            </span>
          </label>
        ))}
      </div>
    </GateSettingsCard>
  )
}
