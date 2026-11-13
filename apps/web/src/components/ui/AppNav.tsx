'use client'

import { usePathname } from 'next/navigation'
import { HashIcon, HomeIcon, SparkleIcon, UserIcon } from '@/components/ui/icons'

type Tab = { href: string; label: string; icon: typeof HomeIcon; match: (path: string) => boolean }

function tabs(accountHref: string, authenticated: boolean): Tab[] {
  return [
    { href: '/', label: 'Feed', icon: HomeIcon, match: (p) => p === '/' || p.startsWith('/r/') },
    {
      href: '/t',
      label: 'Topics',
      icon: HashIcon,
      match: (p) => p === '/t' || p.startsWith('/t/'),
    },
    { href: '/ask', label: 'Ask', icon: SparkleIcon, match: (p) => p.startsWith('/ask') },
    {
      href: accountHref,
      label: authenticated ? 'Profile' : 'Sign in',
      icon: UserIcon,
      match: (p) => p.startsWith('/profile') || p.startsWith('/login'),
    },
  ]
}

type NavProps = { accountHref?: string; authenticated?: boolean; translucent?: boolean }

export function SideNav({ accountHref = '/profile', authenticated = true }: NavProps) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="mt-8 flex flex-col gap-1 text-sm">
      {tabs(accountHref, authenticated).map(({ href, label, icon: Icon, match }) => {
        const active = match(path)
        return (
          <a
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex w-40 items-center gap-3 rounded-md px-3 py-2 transition ${
              active ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg'
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </a>
        )
      })}
    </nav>
  )
}

export function BottomTabs({
  accountHref = '/profile',
  authenticated = true,
  translucent = false,
}: NavProps) {
  const path = usePathname()
  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 bottom-0 z-40 grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden ${
        translucent ? 'border-white/10 bg-black/45 backdrop-blur-md' : 'border-line bg-bg/95'
      }`}
    >
      {tabs(accountHref, authenticated).map(({ href, label, icon: Icon, match }) => {
        const active = match(path)
        return (
          <a
            key={label}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] transition active:scale-95 ${
              active ? 'text-fg' : translucent ? 'text-white/65' : 'text-muted'
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </a>
        )
      })}
    </nav>
  )
}
