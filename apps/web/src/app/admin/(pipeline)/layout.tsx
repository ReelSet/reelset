import { GroupShell } from '@/components/admin/GroupShell'
import { PIPELINE_TABS } from '@/lib/admin/nav'

export default function PipelineLayout({ children }: { children: React.ReactNode }) {
  return (
    <GroupShell
      title="Pipeline"
      description="What is running, what is stuck, and what just finished."
      tabs={PIPELINE_TABS}
    >
      {children}
    </GroupShell>
  )
}
