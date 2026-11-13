import { BottomTabs } from '@/components/ui/AppNav'
import { SideRail } from '@/components/ui/SideRail'
import { getViewer } from '@/server/viewer'

/** Left rail on desktop and bottom tabs on mobile, shared by every non-feed main section. */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null)
  const nav = {
    authenticated: Boolean(viewer),
    avatar: viewer
      ? { url: viewer.identity.avatarUrl, initial: viewer.identity.initial }
      : undefined,
  }
  return (
    <div className="lg:flex">
      <SideRail {...nav} />
      <div className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </div>
      <BottomTabs {...nav} />
    </div>
  )
}
