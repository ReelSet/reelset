import { GroupShell } from '@/components/admin/GroupShell'
import { OVERVIEW_TABS } from '@/lib/admin/nav'

export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <GroupShell
      title="Overview"
      description="How Reelset is doing: usage, spend and what people ask."
      tabs={OVERVIEW_TABS}
    >
      {children}
    </GroupShell>
  )
}
