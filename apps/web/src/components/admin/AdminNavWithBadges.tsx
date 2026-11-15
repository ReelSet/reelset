import { cache } from 'react'
import { errorFields } from '@reelset/core'
import { navBadges, type NavBadges } from '@/lib/admin/nav'
import { attentionCounts } from '@/server/admin/stats'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'
import { AdminNav } from './AdminNav'

const loadBadges = cache(async (): Promise<NavBadges> => {
  try {
    return navBadges(await attentionCounts(getDb()))
  } catch (err) {
    routeLog('admin/nav').warn(errorFields(err), 'attention badges unavailable')
    return {}
  }
})

/** Streams in after the shell so four count queries never delay a page; deduped per request. */
export async function AdminNavWithBadges({ variant }: { variant: 'sidebar' | 'bottom' }) {
  return <AdminNav variant={variant} badges={await loadBadges()} />
}
