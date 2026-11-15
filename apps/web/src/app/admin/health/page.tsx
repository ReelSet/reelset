import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { redirectLegacy } from '@/server/admin/legacy-redirect'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function LegacyHealthPage({ searchParams }: Props) {
  redirectLegacy(ADMIN_ROUTES.ingest, await searchParams)
}
