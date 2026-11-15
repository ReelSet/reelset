import { AdminTabs } from './AdminTabs'
import { PageHeader } from './ui'
import type { AdminTab } from '@/lib/admin/nav'

/** Layout body shared by every tabbed admin group: header on top, tabs underneath. */
export function GroupShell({
  title,
  description,
  tabs,
  children,
}: {
  title: string
  description: string
  tabs: readonly AdminTab[]
  children: React.ReactNode
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <AdminTabs tabs={tabs} label={`${title} sections`} />
      {children}
    </div>
  )
}
