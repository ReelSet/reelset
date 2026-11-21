import { BottomTabs } from '@/components/ui/AppNav'
import { SideRail } from '@/components/ui/SideRail'
import { getViewer } from '@/server/viewer'

type Nav = { authenticated?: boolean; avatar?: { url: string | null; initial: string } }

function Shell({ nav, children }: { nav: Nav; children: React.ReactNode }) {
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

/**
 * Left rail on desktop and bottom tabs on mobile, shared by every non-feed main section. It reads
 * no session on the server, so the pages under it stay cacheable; the nav resolves sign-in state
 * and the avatar in the browser.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <Shell nav={{}}>{children}</Shell>
}

/** For per-viewer pages (profile, create) that are dynamic anyway: the avatar comes from the server. */
export async function ViewerAppShell({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null)
  const nav = {
    authenticated: Boolean(viewer),
    avatar: viewer
      ? { url: viewer.identity.avatarUrl, initial: viewer.identity.initial }
      : undefined,
  }
  return <Shell nav={nav}>{children}</Shell>
}
