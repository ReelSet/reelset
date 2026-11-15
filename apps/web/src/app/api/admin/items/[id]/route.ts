import { adminDetailRoute } from '@/server/admin/detail-route'
import { loadItemDrawer } from '@/server/admin/drawer-data'
import { getDb } from '@/server/db'
import { mediaBaseUrl } from '@/server/env'

export const dynamic = 'force-dynamic'

export const GET = adminDetailRoute('items', (id) => loadItemDrawer(getDb(), id, mediaBaseUrl()))
