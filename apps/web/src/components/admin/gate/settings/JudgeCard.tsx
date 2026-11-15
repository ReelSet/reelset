'use client'

import { useState } from 'react'
import { GATE_FIELD, costCapWarning, type CostMarks } from '@/lib/admin/gate-fields'
import { GateSettingsCard } from './GateSettingsCard'
import { Field, NumberInput, Select } from './controls'

export type JudgeValues = {
  model: string
  effort: string
  exploreRatePercent: number
  exampleCount: number
  maxCostUsdPerItem: number
}

export type JudgeLimits = {
  exploreRatePercentMax: number
  exampleCountMax: number
  maxCostUsdPerItemMax: number
}

type Props = {
  saved: JudgeValues
  models: readonly string[]
  efforts: readonly string[]
  limits: JudgeLimits
  costMarks: Record<string, CostMarks>
  isDefault: boolean
}

const asOptions = (values: readonly string[]) => values.map((value) => ({ value, label: value }))

/** Which model judges, how hard it thinks, and the small numbers around it. */
export function JudgeCard({ saved, models, efforts, limits, costMarks, isDefault }: Props) {
  const [model, setModel] = useState(saved.model)
  const [effort, setEffort] = useState(saved.effort)
  const [explore, setExplore] = useState(String(saved.exploreRatePercent))
  const [examples, setExamples] = useState(String(saved.exampleCount))
  const [maxCost, setMaxCost] = useState(String(saved.maxCostUsdPerItem))
  const costWarning = costCapWarning(costMarks[model], Number(maxCost))
  return (
    <GateSettingsCard
      title="Judge"
      settingKeys="gate_model, gate_effort, gate_explore_rate, gate_example_count, gate_max_cost_usd_per_item"
      isDefault={isDefault}
      hint="Changes apply to the next item the gate judges."
    >
      <Field label="Model" hint="The model that scores the six signals for each item.">
        <Select
          name={GATE_FIELD.model}
          label="Model"
          value={model}
          onChange={setModel}
          options={asOptions(models)}
        />
      </Field>
      <Field
        label="Max cost per item (USD)"
        hint={`The most one judgement may cost. Up to ${limits.maxCostUsdPerItemMax}.`}
      >
        <NumberInput
          name={GATE_FIELD.maxCostUsdPerItem}
          label="Max cost per item in USD"
          value={maxCost}
          onChange={setMaxCost}
          min={0}
          max={limits.maxCostUsdPerItemMax}
        />
      </Field>
      {costWarning ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-warn/50 px-3 py-2 text-xs text-warn"
        >
          {costWarning}
        </p>
      ) : null}
      <Field label="Effort" hint="How long the model thinks. Higher costs more per item.">
        <Select
          name={GATE_FIELD.effort}
          label="Effort"
          value={effort}
          onChange={setEffort}
          options={asOptions(efforts)}
        />
      </Field>
      <Field
        label="Explore rate (%)"
        hint={`Share of items the judge said no to that are made into reels anyway, so you can see whether the no was wrong. 0 to ${limits.exploreRatePercentMax}.`}
      >
        <NumberInput
          name={GATE_FIELD.exploreRatePercent}
          label="Explore rate percent"
          value={explore}
          onChange={setExplore}
          min={0}
          max={limits.exploreRatePercentMax}
        />
      </Field>
      <Field
        label="Examples shown to the judge"
        hint={`How many of your labelled decisions are added to the instructions as examples. 0 to ${limits.exampleCountMax}.`}
      >
        <NumberInput
          name={GATE_FIELD.exampleCount}
          label="Examples shown to the judge"
          value={examples}
          onChange={setExamples}
          min={0}
          max={limits.exampleCountMax}
        />
      </Field>
    </GateSettingsCard>
  )
}
