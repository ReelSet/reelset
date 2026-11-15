import { AdminShell } from '@/components/admin/AdminShell'
import { TimeZoneProvider } from '@/components/ui/TimeZoneContext'
import { assertAdmin } from '@/server/admin/guard'
import { viewerTimeZone } from '@/server/timezone'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: { default: 'Admin', template: '%s | Reelset admin' },
  robots: { index: false, follow: false },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdmin()
  const tz = await viewerTimeZone()
  return (
    <TimeZoneProvider value={tz}>
      <AdminShell>{children}</AdminShell>
    </TimeZoneProvider>
  )
}
