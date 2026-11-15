import { adminDetailRoute } from '@/server/admin/detail-route'
import { getDb } from '@/server/db'
import { userDetail } from '@/server/admin/users'

export const dynamic = 'force-dynamic'

export const GET = adminDetailRoute('users', (id) => userDetail(getDb(), id))
