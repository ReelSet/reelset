import { BottomTabs, SideNav } from '@/components/ui/AppNav'
import { Wordmark } from '@/components/ui/Logo'
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
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-6 py-10 lg:flex">
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-lg" />
        </a>
        <SideNav {...nav} />
      </aside>
      <div className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
        {children}
      </div>
      <BottomTabs {...nav} />
    </div>
  )
}
