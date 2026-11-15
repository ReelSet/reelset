import Link from 'next/link'
import { AutoRefresh } from '@/components/admin/pipeline/AutoRefresh'
import { Stepper } from '@/components/admin/pipeline/Stepper'
import { SubmitButton } from '@/components/admin/SubmitButton'
import {
  Empty,
  Flash,
  PageHeader,
  Pager,
  Section,
  Status,
  Table,
  button,
  buttonPrimary,
  input,
  td,
  th,
} from '@/components/admin/ui'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { relativeTime, type Step } from '@/lib/admin/pipeline'
import { assertAdmin } from '@/server/admin/guard'
import { getDb } from '@/server/db'
import { listAllRequests, listOpenUpgradeRequests } from '@/server/generate/service'
import { routeLog } from '@/server/logger'
import {
  dismissAction,
  generateAction,
  grantAction,
  retryRequestAction,
  visibilityAction,
} from './actions'

export const metadata = { title: 'Generate' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PATH = ADMIN_ROUTES.generate
const PAGE_SIZE = 30
const OPEN = ['pending', 'resolving', 'processing']

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default async function GeneratePage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const now = new Date()
  const page = parsePage(sp.page, PAGE_SIZE)
  const log = routeLog('admin/generate')
  const [rows, upgrades] = await Promise.all([
    listAllRequests(db, { limit: PAGE_SIZE + 1, offset: page.offset }, log),
    listOpenUpgradeRequests(db),
  ])
  const visible = rows.slice(0, PAGE_SIZE)
  const hasMore = rows.length > PAGE_SIZE
  const anyOpen = visible.some((r) => OPEN.includes(r.dto.status))
  const returnTo = PATH

  return (
    <div>
      <Flash value={sp.flash} />
      <PageHeader
        title="Generate"
        description="Reels made from user links. Requested reels stay private until you publish them."
        actions={<AutoRefresh renderedAt={now.toISOString()} />}
      />

      <Section title="Generate a reel (no credits charged)">
        <form action={generateAction} className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <input type="hidden" name="returnTo" value={returnTo} />
          <textarea
            name="urls"
            rows={3}
            required
            placeholder="One link per line, up to 5"
            className={`${input} min-h-[4.5rem] w-full max-w-xl resize-y font-mono text-xs`}
          />
          <SubmitButton className={buttonPrimary} pendingLabel="Queuing">
            Generate
          </SubmitButton>
        </form>
      </Section>

      <Section title="Requests" aside={anyOpen ? <span className="text-faint">live</span> : null}>
        {visible.length === 0 ? (
          <Empty>No requests yet</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Links</th>
                <th className={th}>Progress</th>
                <th className={th}>Created</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ dto, userLabel }) => {
                const steps: Step[] = dto.steps.map((s) => ({
                  key: s.key,
                  label: s.label,
                  state: s.state === 'todo' ? 'pending' : s.state,
                }))
                const reel = dto.reel
                return (
                  <tr key={dto.id}>
                    <td className={td}>
                      <div>{userLabel}</div>
                      <div className="text-faint">{dto.via}</div>
                    </td>
                    <td className={`${td} max-w-[16rem]`}>
                      {dto.urls.map((u) => (
                        <a
                          key={u}
                          href={u}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={u}
                          className="block truncate"
                        >
                          {hostOf(u)}
                        </a>
                      ))}
                    </td>
                    <td className={`${td} min-w-[18rem]`}>
                      <div className="mb-1 flex items-center gap-2">
                        <Status value={dto.status} />
                        {dto.aheadOfYou ? (
                          <span className="text-faint">{dto.aheadOfYou} ahead</span>
                        ) : null}
                        {reel?.visibility === 'private' && dto.status === 'done' ? (
                          <span className="text-warn">private</span>
                        ) : null}
                      </div>
                      <Stepper steps={steps} compact />
                      {dto.error ? <p className="mt-1 text-danger">{dto.error}</p> : null}
                    </td>
                    <td className={`${td} whitespace-nowrap text-faint`}>
                      {relativeTime(dto.createdAt, now)}
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1">
                        {reel?.pageUrl ? (
                          <a href={reel.pageUrl} className={button}>
                            Open
                          </a>
                        ) : null}
                        {reel?.videoUrl ? (
                          <a href={reel.downloadUrl ?? reel.videoUrl} download className={button}>
                            Download
                          </a>
                        ) : null}
                        {reel && dto.status === 'done' ? (
                          <form action={visibilityAction}>
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="itemId" value={reel.itemId} />
                            <input
                              type="hidden"
                              name="visibility"
                              value={reel.visibility === 'private' ? 'public' : 'private'}
                            />
                            <SubmitButton className={button} pendingLabel="Saving">
                              {reel.visibility === 'private' ? 'Publish to feed' : 'Unpublish'}
                            </SubmitButton>
                          </form>
                        ) : null}
                        {reel && dto.status === 'done' ? (
                          <Link
                            href={`${ADMIN_ROUTES.instagram}?item=${reel.itemId}#compose`}
                            className={button}
                          >
                            Queue to Instagram
                          </Link>
                        ) : null}
                        {dto.status === 'failed' ? (
                          <form action={retryRequestAction}>
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input type="hidden" name="requestId" value={dto.id} />
                            <SubmitButton className={button} pendingLabel="Retrying">
                              Retry
                            </SubmitButton>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
        <Pager path={PATH} params={{}} page={page.page} hasMore={hasMore} />
      </Section>

      <section id="upgrades" className="mb-9 scroll-mt-6">
        <h2 className="mb-3 text-[13px] font-medium text-muted">Credit requests</h2>
        {upgrades.length === 0 ? (
          <Empty>No open credit requests</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Message</th>
                <th className={th}>Asked</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {upgrades.map((u) => (
                <tr key={u.id}>
                  <td className={td}>{u.email}</td>
                  <td className={`${td} max-w-sm whitespace-pre-wrap`}>{u.message ?? ''}</td>
                  <td className={`${td} whitespace-nowrap text-faint`}>
                    {relativeTime(u.created_at, now)}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap items-center gap-1">
                      <form action={grantAction} className="flex items-center gap-1">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="id" value={u.id} />
                        <span className="text-xs text-faint">Grant credits for this month</span>
                        <input
                          type="number"
                          name="credits"
                          defaultValue={1000}
                          min={1}
                          className={`${input} w-24`}
                        />
                        <SubmitButton className={buttonPrimary} pendingLabel="Granting">
                          Grant
                        </SubmitButton>
                      </form>
                      <form action={dismissAction}>
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton className={button} pendingLabel="Dismissing">
                          Dismiss
                        </SubmitButton>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}
