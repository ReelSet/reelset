import { ViewerAppShell } from '@/components/ui/AppShell'
import { TimeZoneProvider } from '@/components/ui/TimeZoneContext'
import { viewerTimeZone } from '@/server/timezone'

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  const tz = await viewerTimeZone()
  return (
    <TimeZoneProvider value={tz}>
      <ViewerAppShell>{children}</ViewerAppShell>
    </TimeZoneProvider>
  )
}
