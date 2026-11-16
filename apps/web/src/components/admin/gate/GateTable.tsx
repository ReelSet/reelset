import { bulkAgreeGateAction } from '@/app/admin/(pipeline)/gate/actions'
import { ItemLink } from '@/components/admin/drawer/DrawerLink'
import { SelectAllCheckbox } from '@/components/admin/moderation/SelectAllCheckbox'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { SortTh, type SortCtx } from '@/components/admin/sortable'
import { Table, buttonPrimary, statusLabel, td, th } from '@/components/admin/ui'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { fmtDate, fmtPct, truncate } from '@/lib/admin/format'
import type { GateSortKey } from '@/lib/admin/gate'
import { relativeTime } from '@/lib/admin/pipeline'
import type { GateOutcome, GateQueueRow } from '@/server/admin/gate-queries'
import { Chip, DecidedBy, ReviewState, ScoreBar, VerdictSummary } from './GateBadges'
import { GateReviewActions } from './GateReviewActions'

export const GATE_BULK_FORM_ID = 'gate-bulk-agree'
const BULK_FIELD = 'decisionId'
const REASON_CHIPS = 3
const ROW_FOCUS =
  'outline-none focus:bg-white/[0.04] [&:focus>td:first-child]:shadow-[inset_2px_0_0_var(--color-accent)]'

type RowContext = { tz: string; now: Date; returnTo: string }

/** One form for the whole table: row checkboxes join it through their `form` attribute. */
export function BulkAgreeBar({ returnTo, count }: { returnTo: string; count: number }) {
  return (
    <form
      id={GATE_BULK_FORM_ID}
      action={bulkAgreeGateAction}
      data-gate-form
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2"
    >
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className="text-xs text-muted">{count} on this page</span>
      <SubmitButton className={buttonPrimary} pendingLabel="Agreeing">
        Agree with selected
      </SubmitButton>
      <span className="text-xs text-faint">Decisions that already have a review are skipped.</span>
    </form>
  )
}

function Outcome({ outcome }: { outcome: GateOutcome | undefined }) {
  if (!outcome) return null
  return (
    <div className="whitespace-nowrap text-xs tabular-nums text-muted">
      {outcome.igViews === null ? null : (
        <div className="text-fg">
          IG {outcome.igViews.toLocaleString('en-US')} views · {outcome.igLikes ?? 0} likes
        </div>
      )}
      <div>
        App {outcome.views.toLocaleString('en-US')} views · {outcome.likes} likes
      </div>
      {outcome.avgWatchRatio === null ? null : (
        <div className="text-faint">{fmtPct(outcome.avgWatchRatio)} watched on average</div>
      )}
    </div>
  )
}

function TitleCell({ row }: { row: GateQueueRow }) {
  const { gate } = row
  return (
    <td className={`${td} min-w-64 max-w-md`}>
      <span data-gate-title>
        <ItemLink
          id={gate.itemId}
          title={row.title}
          source={row.source}
          status={row.itemStatus}
          className="text-fg hover:text-info"
        >
          {truncate(row.title, 90)}
        </ItemLink>
      </span>
      {gate.reasons.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {gate.reasons.slice(0, REASON_CHIPS).map((reason) => (
            <Chip key={reason}>{truncate(reason, 48)}</Chip>
          ))}
        </div>
      ) : null}
      <div className="mt-1 text-xs text-faint">Item is {statusLabel(row.itemStatus)}</div>
    </td>
  )
}

function DecisionRow({
  row,
  outcome,
  ctx,
}: {
  row: GateQueueRow
  outcome: GateOutcome | undefined
  ctx: RowContext
}) {
  const { gate } = row
  return (
    <tr
      data-gate-row
      data-decision={gate.decisionId}
      data-reviewed={gate.label !== null || gate.decidedBy === 'admin'}
      tabIndex={-1}
      className={ROW_FOCUS}
    >
      <td className={td}>
        <input
          type="checkbox"
          name={BULK_FIELD}
          value={gate.decisionId}
          form={GATE_BULK_FORM_ID}
          aria-label={`Select ${truncate(row.title, 60)}`}
        />
      </td>
      <td className={td}>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <SourceDot source={row.source} />
          {sourceMeta(row.source).label}
        </span>
      </td>
      <TitleCell row={row} />
      <td className={td}>
        <VerdictSummary gate={gate} />
        {gate.appliedNote ? (
          <div className="mt-1 text-[11px] text-faint">{gate.appliedNote}</div>
        ) : null}
      </td>
      <td className={td}>
        <ScoreBar gate={gate} />
      </td>
      <td className={`${td} text-muted`}>
        <DecidedBy gate={gate} />
      </td>
      <td className={`${td} whitespace-nowrap text-muted`} title={fmtDate(gate.decidedAt, ctx.tz)}>
        {relativeTime(gate.decidedAt, ctx.now)}
      </td>
      <td className={td}>
        <Outcome outcome={outcome} />
      </td>
      <td className={`${td} min-w-60`}>
        <div className="mb-1.5 text-xs">
          <ReviewState gate={gate} />
        </div>
        <GateReviewActions
          gate={gate}
          itemStatus={row.itemStatus}
          returnTo={ctx.returnTo}
          keyHints
        />
      </td>
    </tr>
  )
}

/** The review queue: one focusable row per decision, with the same actions the keyboard shortcuts trigger. */
export function GateTable({
  rows,
  outcomes,
  sortCtx,
  ctx,
}: {
  rows: GateQueueRow[]
  outcomes: Map<string, GateOutcome>
  sortCtx: SortCtx<GateSortKey>
  ctx: RowContext
}) {
  return (
    <div data-gate-table>
      <Table>
        <thead>
          <tr>
            <th className={th}>
              <SelectAllCheckbox formId={GATE_BULK_FORM_ID} name={BULK_FIELD} />
            </th>
            <th className={th}>Source</th>
            <th className={th}>Title</th>
            <th className={th}>Verdict</th>
            <SortTh ctx={sortCtx} col="score" />
            <th className={th}>Decided by</th>
            <SortTh ctx={sortCtx} col="decided" />
            <th className={th}>Outcome</th>
            <th className={th}>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <DecisionRow
              key={row.gate.decisionId}
              row={row}
              outcome={outcomes.get(row.gate.itemId)}
              ctx={ctx}
            />
          ))}
        </tbody>
      </Table>
    </div>
  )
}
