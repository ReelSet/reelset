import { SubmitButton } from '@/components/admin/SubmitButton'
import { Empty, Section, Table, button, buttonPrimary, input, td, th } from '@/components/admin/ui'
import { fmtDate } from '@/lib/admin/format'
import type { FeedSubmission } from '@/server/admin/publish-review'
import { approveSubmissionAction, rejectSubmissionAction } from '@/app/admin/generate/actions'

type Props = { submissions: FeedSubmission[]; tz: string; returnTo: string }

const REVIEW_LABEL = { pending: 'In review', approved: 'Live', rejected: 'Rejected' } as const
const REVIEW_TONE = { pending: 'text-warn', approved: 'text-ok', rejected: 'text-danger' } as const

function Poster({ url }: { url: string | null }) {
  if (!url) return <div className="h-16 w-9 rounded bg-raised" aria-hidden />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-16 w-9 rounded object-cover" loading="lazy" />
}

function ReviewActions({ itemId, returnTo }: { itemId: string; returnTo: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <form action={approveSubmissionAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="itemId" value={itemId} />
        <SubmitButton className={buttonPrimary} pendingLabel="Approving">
          Approve
        </SubmitButton>
      </form>
      <form action={rejectSubmissionAction} className="flex items-center gap-1">
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="itemId" value={itemId} />
        <input
          name="note"
          maxLength={300}
          placeholder="Note for the owner (optional)"
          aria-label="Rejection note"
          className={`${input} w-52`}
        />
        <SubmitButton className={button} pendingLabel="Rejecting">
          Reject
        </SubmitButton>
      </form>
    </div>
  )
}

function SubmissionRow({ s, tz, returnTo }: { s: FeedSubmission; tz: string; returnTo: string }) {
  return (
    <tr>
      <td className={td}>
        <Poster url={s.posterUrl} />
      </td>
      <td className={`${td} max-w-xs`}>
        <div className="font-medium">{s.title}</div>
        <div className="text-faint">{s.ownerLabel}</div>
        {s.note ? <p className="mt-1 text-muted">Note: {s.note}</p> : null}
      </td>
      <td className={`${td} whitespace-nowrap`}>
        <div className={REVIEW_TONE[s.review]}>{REVIEW_LABEL[s.review]}</div>
        <div className="text-faint">{fmtDate(s.requestedAt, tz)}</div>
      </td>
      <td className={td}>
        <div className="flex flex-wrap items-center gap-1">
          <a href={s.pageUrl} target="_blank" rel="noreferrer noopener" className={button}>
            Watch
          </a>
          {s.review === 'pending' ? <ReviewActions itemId={s.itemId} returnTo={returnTo} /> : null}
        </div>
      </td>
    </tr>
  )
}

export function FeedSubmissions({ submissions, tz, returnTo }: Props) {
  const pending = submissions.filter((s) => s.review === 'pending').length
  return (
    <div id="submissions" className="scroll-mt-6">
      <Section
        title="Feed submissions"
        aside={pending > 0 ? <span className="text-warn">{pending} to review</span> : null}
      >
        {submissions.length === 0 ? (
          <Empty>No feed submissions yet</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Reel</th>
                <th className={th}>Title and owner</th>
                <th className={th}>Status, submitted</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <SubmissionRow key={s.itemId} s={s} tz={tz} returnTo={returnTo} />
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  )
}
