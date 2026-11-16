'use client'

import { useActionState } from 'react'
import { checkGateLinkAction } from '@/app/admin/(pipeline)/gate/actions'
import { ItemLink } from '@/components/admin/drawer/DrawerLink'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { buttonPrimary, input, statusLabel } from '@/components/admin/primitives'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { JUDGE_NOW_NOTE } from '@/lib/admin/gate-view'
import type { CheckedItem, LinkCheck } from '@/server/admin/gate-judge'
import { Chip, ScoreBar, SignalBars, VerdictSummary } from './GateBadges'

const LINK_MAX_CHARS = 2000

function ItemLine({ item }: { item: CheckedItem }) {
  return (
    <div className="min-w-0">
      <ItemLink
        id={item.id}
        title={item.title}
        source={item.source}
        status={item.status}
        className="text-[13px] font-medium text-fg hover:text-info"
      >
        {item.title}
      </ItemLink>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-faint">
        <span className="inline-flex items-center gap-1.5">
          <SourceDot source={item.source} />
          {sourceMeta(item.source).label}
        </span>
        <span>Item is {statusLabel(item.status)}</span>
        <span>Select the title to open its details</span>
      </p>
    </div>
  )
}

function ScoreCard({ check }: { check: Extract<LinkCheck, { kind: 'card' }> }) {
  const { item, gate } = check
  return (
    <div className="space-y-3">
      <ItemLine item={item} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <VerdictSummary gate={gate} />
        <ScoreBar gate={gate} />
        <span className="text-xs text-faint">
          {check.judgedNow ? 'Judged just now' : 'Already judged; this is the newest judgement'}
        </span>
      </div>
      {gate.signals.length > 0 ? (
        <div className="max-w-md">
          <SignalBars signals={gate.signals} />
        </div>
      ) : null}
      {gate.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {gate.reasons.map((reason) => (
            <Chip key={reason}>{reason}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Result({ check }: { check: LinkCheck }) {
  if (check.kind === 'card') return <ScoreCard check={check} />
  if (check.kind === 'failed') {
    return (
      <div className="space-y-2">
        <ItemLine item={check.item} />
        <p role="alert" className="text-xs text-danger">
          {check.message}
        </p>
      </div>
    )
  }
  return (
    <p
      role="status"
      className={`text-xs ${check.kind === 'invalid' ? 'text-danger' : 'text-muted'}`}
    >
      {check.message}
    </p>
  )
}

/** "Check a link": paste a reel link, source URL or item id and see the gate's score card for it; judges the item once if it never was. */
export function GateLinkCheck() {
  const [check, submit] = useActionState(checkGateLinkAction, null)
  return (
    <section className="mb-6 rounded-md border border-line bg-surface p-4">
      <h2 className="text-[13px] font-medium">Check a link</h2>
      <p className="mb-3 mt-1 text-xs text-faint">
        Paste a reelset reel link, a source URL or an item id to see what the gate says about it.{' '}
        {JUDGE_NOW_NOTE}
      </p>
      <form action={submit} className="flex flex-wrap gap-2">
        <input
          name="link"
          required
          maxLength={LINK_MAX_CHARS}
          placeholder="https://reelset.app/r/... or a source URL or an item id"
          aria-label="Link or item id"
          className={`${input} min-w-0 flex-1 basis-72`}
        />
        <SubmitButton className={buttonPrimary} pendingLabel="Checking, up to a minute">
          Check
        </SubmitButton>
      </form>
      {check ? (
        <div className="mt-3 border-t border-line pt-3">
          <Result check={check} />
        </div>
      ) : null}
    </section>
  )
}
