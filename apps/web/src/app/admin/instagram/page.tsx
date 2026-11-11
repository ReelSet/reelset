import Link from 'next/link'
import { queuedPostEtas } from '@reelset/core'
import { z } from 'zod'
import { pageHref, parsePage } from '@/lib/admin/pagination'
import { mediaUrl } from '@/lib/media'
import { workerConfigFromEnv } from '@/lib/instagram/worker-client'
import { Empty, Flash, Pager, Section } from '@/components/admin/ui'
import { AutoRefresh } from '@/components/admin/pipeline/AutoRefresh'
import { AccountCard } from '@/components/admin/instagram/AccountCard'
import { Composer } from '@/components/admin/instagram/Composer'
import { QueueList } from '@/components/admin/instagram/QueueList'
import { ReelGrid } from '@/components/admin/instagram/ReelGrid'
import { queuePostAction } from './actions'
import { assertAdmin } from '@/server/admin/guard'
import {
  REELS_PAGE_SIZE,
  composerReel,
  postQueue,
  lastPostedAt,
  publishedReels,
  readAccount,
  readCheckError,
} from '@/server/admin/instagram'
import { mediaBaseUrl } from '@/server/env'
import { getDb } from '@/server/db'

export const metadata = { title: 'Instagram' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PATH = '/admin/instagram'

export default async function InstagramPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const now = new Date()
  const page = parsePage(sp.page, REELS_PAGE_SIZE)
  const itemParam = z.guid().safeParse(Array.isArray(sp.item) ? sp.item[0] : sp.item)
  const mediaBase = mediaBaseUrl()

  const [account, checkError, reels, rawQueue, lastPosted, composer] = await Promise.all([
    readAccount(db),
    readCheckError(db),
    publishedReels(db, page.offset),
    postQueue(db),
    lastPostedAt(db),
    itemParam.success ? composerReel(db, itemParam.data) : Promise.resolve(null),
  ])
  const queuedOldestFirst = rawQueue.filter((r) => r.status === 'queued').reverse()
  const etas = queuedPostEtas(queuedOldestFirst.length, lastPosted, now)
  const etaById = new Map(queuedOldestFirst.map((r, i) => [r.id, etas[i] ?? null]))
  const queue = rawQueue.map((r) => ({ ...r, etaAt: etaById.get(r.id) ?? null }))
  const configured = workerConfigFromEnv() !== null
  const gridHref = (id: string) =>
    `${pageHref(PATH, {}, page.page)}${page.page > 1 ? '&' : '?'}item=${id}#compose`
  const returnTo = composer ? `${PATH}?item=${composer.id}` : PATH
  const live = composer?.post_status ?? null
  const blockedReason =
    live === 'posted'
      ? 'This reel is already posted.'
      : live
        ? 'This reel is already in the queue.'
        : null
  const notConnected = account?.state !== 'connected'

  return (
    <div>
      <Flash value={sp.flash} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Instagram</h1>
          <p className="mt-1 text-[13px] text-faint">
            Pick a finished reel, check the caption, queue it. Posts go out one at a time.
          </p>
        </div>
        <AutoRefresh renderedAt={now.toISOString()} />
      </div>

      <AccountCard
        account={account}
        checkError={checkError}
        configured={configured}
        returnTo={returnTo}
      />

      {itemParam.success && !composer ? (
        <Empty>That reel is not available to post (it needs a finished render).</Empty>
      ) : null}

      {composer ? (
        <section
          id="compose"
          className="mb-9 scroll-mt-4 rounded-md border border-line bg-surface p-4 sm:p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[13px] font-medium text-muted">Compose</h2>
              <p className="mt-0.5 line-clamp-2 font-medium">{composer.title}</p>
            </div>
            <Link
              href={pageHref(PATH, {}, page.page)}
              scroll={false}
              className="shrink-0 text-xs text-faint hover:text-fg"
            >
              Close
            </Link>
          </div>
          <Composer
            key={composer.id}
            itemId={composer.id}
            videoKey={composer.video_key}
            title={composer.title}
            videoUrl={mediaUrl(mediaBase, composer.video_key) ?? ''}
            posterUrl={mediaUrl(mediaBase, composer.poster_key)}
            draftCaption={composer.draftCaption}
            username={account?.username ?? null}
            returnTo={returnTo}
            blockedReason={blockedReason}
            notice={
              notConnected
                ? 'Instagram is not connected. The post waits in the queue until you connect.'
                : null
            }
            queueAction={queuePostAction}
          />
          {live === 'posted' && composer.permalink ? (
            <p className="mt-3 text-xs">
              <a
                href={composer.permalink}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline"
              >
                Open the post on Instagram
              </a>
            </p>
          ) : null}
        </section>
      ) : null}

      <Section title={`Queue and history · ${queue.length}`}>
        {queue.length === 0 ? (
          <Empty>No posts yet. Select a reel below to compose one.</Empty>
        ) : (
          <QueueList
            rows={queue}
            now={now}
            returnTo={returnTo}
            hrefFor={(id) => `/admin?item=${id}`}
          />
        )}
      </Section>

      <Section title="Finished reels">
        {reels.rows.length === 0 ? (
          <Empty>No finished reels yet.</Empty>
        ) : (
          <ReelGrid
            reels={reels.rows}
            mediaBase={mediaBase}
            selectedId={composer?.id ?? null}
            hrefFor={gridHref}
          />
        )}
        <Pager path={PATH} params={{}} page={page.page} hasMore={reels.hasMore} />
      </Section>
    </div>
  )
}
