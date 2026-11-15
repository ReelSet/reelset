'use client'

import { useActionState, useState } from 'react'
import { testGateTuningAction } from '@/app/admin/(pipeline)/gate/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { button } from '@/components/admin/primitives'
import { fmtPct } from '@/lib/admin/format'
import { GATE_FIELD } from '@/lib/admin/gate-fields'
import type { DryRunResult, ThresholdSuggestion } from '@/lib/admin/gate-tuning'
import type { GateDryRun } from '@/server/admin/gate'
import { GateSettingsCard } from './GateSettingsCard'
import { Field, SliderNumber } from './controls'

export type SignalField = { key: string; label: string; description: string }

type Props = {
  threshold: number
  weights: Record<string, number>
  signals: readonly SignalField[]
  scoreMax: number
  weightMax: number
  suggestion: ThresholdSuggestion | null
  suggestMinLabels: number
  isDefault: boolean
}

const asShare = (part: number, whole: number) => (whole > 0 ? part / whole : null)
const numeric = (text: string) => (Number.isFinite(Number(text)) ? Number(text) : 0)

function Suggestion({
  suggestion,
  minLabels,
  onUse,
}: {
  suggestion: ThresholdSuggestion | null
  minLabels: number
  onUse: (threshold: number) => void
}) {
  if (!suggestion) {
    return (
      <p className="text-xs text-faint">
        Not enough labels yet to suggest a threshold. It needs at least {minLabels} labelled
        decisions, with some on each side.
      </p>
    )
  }
  const { threshold, matches, currentMatches, sample } = suggestion
  if (matches === currentMatches) {
    return (
      <p className="text-xs text-faint">
        No other threshold fits your labels better: this one matches {currentMatches} of {sample}{' '}
        labelled decisions.
      </p>
    )
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
      Suggested threshold: {threshold}. It matches {matches} of {sample} labelled decisions; the
      current one matches {currentMatches}.
      <button type="button" className={button} onClick={() => onUse(threshold)}>
        Use {threshold}
      </button>
    </p>
  )
}

function DryRunSummary({ result }: { result: DryRunResult }) {
  if (result.sample === 0) {
    return <p className="text-xs text-faint">No model-judged decisions to test on yet.</p>
  }
  return (
    <ul className="space-y-1 text-xs text-muted">
      <li>
        Tested on the last {result.sample} model-judged decisions: {result.reelToSourceOnly} flip
        from reel to source only, {result.sourceOnlyToReel} flip from source only to reel.
      </li>
      <li>
        Reel share goes from {fmtPct(asShare(result.reelsBefore, result.sample))} to{' '}
        {fmtPct(asShare(result.reelsAfter, result.sample))}.
      </li>
      <li>
        {result.labelled === 0
          ? 'None of them has an admin label yet, so there is nothing to score against.'
          : `Of ${result.labelled} labelled decisions, ${result.matchedAfter} would match your label; ${result.matchedBefore} matched before.`}
      </li>
    </ul>
  )
}

function DryRunPanel({ run }: { run: GateDryRun | null }) {
  if (!run) return null
  return (
    <div role="status" className="mt-3 rounded-md border border-line bg-bg p-3">
      {run.ok ? (
        <>
          <DryRunSummary result={run.result} />
          {run.suggestion && run.suggestion.matches > run.suggestion.currentMatches ? (
            <p className="mt-1 text-xs text-muted">
              With these weights, a threshold of {run.suggestion.threshold} would match{' '}
              {run.suggestion.matches} of {run.suggestion.sample} labelled decisions.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-danger">{run.message}</p>
      )}
    </div>
  )
}

/** Threshold and signal weights, with a dry run of unsaved values against recent decisions. */
export function TuningCard(props: Props) {
  const { signals, scoreMax, weightMax } = props
  const [threshold, setThreshold] = useState(String(props.threshold))
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(signals.map(({ key }) => [key, String(props.weights[key] ?? 0)])),
  )
  const [run, test] = useActionState(testGateTuningAction, null)
  const total = signals.reduce((sum, { key }) => sum + numeric(weights[key] ?? ''), 0)

  return (
    <GateSettingsCard
      title="Threshold and signal weights"
      settingKeys="gate_threshold, gate_weights"
      isDefault={props.isDefault}
      hint="The judge marks six signals from 0 to 10. The weights turn them into one score out of 100, and the threshold decides."
      reset={{ name: 'weights', label: 'Reset weights to default' }}
      actions={
        <SubmitButton className={button} pendingLabel="Testing" formAction={test}>
          Test on recent decisions
        </SubmitButton>
      }
    >
      <Field
        label="Threshold"
        hint={`Items scoring ${threshold || '?'} or more out of ${scoreMax} become reels. The rest are kept as source only.`}
      >
        <SliderNumber
          name={GATE_FIELD.threshold}
          label="Threshold"
          value={threshold}
          onChange={setThreshold}
          min={0}
          max={scoreMax}
          step={1}
        />
      </Field>
      <div className="mb-2">
        <Suggestion
          suggestion={props.suggestion}
          minLabels={props.suggestMinLabels}
          onUse={(value) => setThreshold(String(value))}
        />
      </div>
      {signals.map((signal) => (
        <Field
          key={signal.key}
          label={`${signal.label} · ${fmtPct(asShare(numeric(weights[signal.key] ?? ''), total))} of the score`}
          hint={signal.description}
        >
          <SliderNumber
            name={GATE_FIELD.weight(signal.key)}
            label={`${signal.label} weight`}
            value={weights[signal.key] ?? ''}
            onChange={(value) => setWeights((current) => ({ ...current, [signal.key]: value }))}
            min={0}
            max={weightMax}
            step={0.5}
          />
        </Field>
      ))}
      <p className="mt-1 text-xs text-faint">
        The dry run re-scores the signals already stored with each decision, so it covers the
        threshold and the weights only. Changes to the instructions, the model or the per-source
        rules are not covered.
      </p>
      <DryRunPanel run={run} />
    </GateSettingsCard>
  )
}
