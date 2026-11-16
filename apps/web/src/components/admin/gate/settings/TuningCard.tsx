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

type Props = {
  threshold: number
  scoreMax: number
  promptVersion: string
  suggestion: ThresholdSuggestion | null
  suggestMinLabels: number
  isDefault: boolean
}

const asShare = (part: number, whole: number) => (whole > 0 ? part / whole : null)

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
        decisions from the current prompt version, with some on each side.
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
    return (
      <p className="text-xs text-faint">
        No decisions from the current prompt version to test on yet.
      </p>
    )
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
        <DryRunSummary result={run.result} />
      ) : (
        <p className="text-xs text-danger">{run.message}</p>
      )}
    </div>
  )
}

/** The threshold, with a dry run of an unsaved value against the scores of recent decisions. */
export function TuningCard(props: Props) {
  const { scoreMax, promptVersion } = props
  const [threshold, setThreshold] = useState(String(props.threshold))
  const [run, test] = useActionState(testGateTuningAction, null)

  return (
    <GateSettingsCard
      title="Threshold"
      settingKeys="gate_threshold"
      isDefault={props.isDefault}
      hint={`The judge gives each item one rating from 0 to ${scoreMax} for how well it would do as a reel. The threshold decides.`}
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
      <p className="mt-1 text-xs text-faint">
        The dry run and the suggestion re-cut the scores already stored with each decision against
        the threshold; no model is called. They use only decisions judged with the current prompt
        version ({promptVersion}), because earlier versions scored on a different scale. Changes to
        the instructions, the model or the per-source rule modes are not covered.
      </p>
      <DryRunPanel run={run} />
    </GateSettingsCard>
  )
}
