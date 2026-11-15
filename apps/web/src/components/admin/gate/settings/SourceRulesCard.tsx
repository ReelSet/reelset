'use client'

import { useState } from 'react'
import { td, th } from '@/components/admin/primitives'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { GATE_FIELD, SOURCE_RULE_MODE_LABELS } from '@/lib/admin/gate-fields'
import { GateSettingsCard } from './GateSettingsCard'
import { NumberInput, Select } from './controls'

export type SourceRuleValue = { mode: string; threshold?: number; minItemScore?: number }
type RuleText = { mode: string; threshold: string; minItemScore: string }

type Props = {
  rules: Record<string, SourceRuleValue>
  sources: readonly string[]
  modes: readonly string[]
  scoreMax: number
  isDefault: boolean
}

const text = (value: number | undefined) => (value === undefined ? '' : String(value))

function toText(rule: SourceRuleValue | undefined): RuleText {
  return {
    mode: rule?.mode ?? 'judge',
    threshold: text(rule?.threshold),
    minItemScore: text(rule?.minItemScore),
  }
}

/** One row per source: let the judge decide, or settle the source by rule without a model call. */
export function SourceRulesCard({ rules, sources, modes, scoreMax, isDefault }: Props) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(sources.map((source) => [source, toText(rules[source])])),
  )
  const modeOptions = modes.map((mode) => ({
    value: mode,
    label: SOURCE_RULE_MODE_LABELS[mode] ?? mode,
  }))
  const set = (source: string, patch: Partial<RuleText>) =>
    setValues((current) => ({
      ...current,
      [source]: { ...toText(undefined), ...current[source], ...patch },
    }))

  return (
    <GateSettingsCard
      title="Per-source rules"
      settingKeys="gate_source_rules"
      isDefault={isDefault}
      hint="Always reel and Always source only skip the judge for that source. A threshold override replaces the main threshold; items below the minimum item score are kept as source only without a model call. Leave a box empty for no override."
      reset={{ name: 'sourceRules', label: 'Reset rules to default' }}
    >
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[13px] [&_tbody_tr:last-child_td]:border-b-0">
          <thead>
            <tr>
              <th className={th}>Source</th>
              <th className={th}>Mode</th>
              <th className={th}>Threshold override</th>
              <th className={th}>Min item score (0 to 1)</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => {
              const rule = values[source] ?? toText(undefined)
              const label = sourceMeta(source).label
              return (
                <tr key={source}>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <SourceDot source={source} />
                      {label}
                    </span>
                  </td>
                  <td className={td}>
                    <Select
                      name={GATE_FIELD.ruleMode(source)}
                      label={`${label} mode`}
                      value={rule.mode}
                      onChange={(mode) => set(source, { mode })}
                      options={modeOptions}
                    />
                  </td>
                  <td className={td}>
                    <NumberInput
                      name={GATE_FIELD.ruleThreshold(source)}
                      label={`${label} threshold override`}
                      value={rule.threshold}
                      onChange={(threshold) => set(source, { threshold })}
                      min={0}
                      max={scoreMax}
                    />
                  </td>
                  <td className={td}>
                    <NumberInput
                      name={GATE_FIELD.ruleMinItemScore(source)}
                      label={`${label} minimum item score`}
                      value={rule.minItemScore}
                      onChange={(minItemScore) => set(source, { minItemScore })}
                      min={0}
                      max={1}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </GateSettingsCard>
  )
}
