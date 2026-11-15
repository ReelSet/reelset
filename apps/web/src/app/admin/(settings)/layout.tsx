import { GroupShell } from '@/components/admin/GroupShell'
import { SETTINGS_TABS } from '@/lib/admin/nav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GroupShell
      title="Settings"
      description="Runtime knobs and the director that writes each reel."
      tabs={SETTINGS_TABS}
    >
      {children}
    </GroupShell>
  )
}
