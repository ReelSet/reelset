'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { HashIcon, HomeIcon, SparkleIcon, UserIcon } from '@/components/ui/icons'
import { buildLoginUrl } from '@/lib/auth/return-url'

type NavAvatar = { url: string | null; initial: string }
type Tab = { href: string; label: string; icon: typeof HomeIcon; match: (path: string) => boolean }

function tabs(path: string, authenticated: boolean): Tab[] {
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
      href: authenticated ? '/profile' : buildLoginUrl(path),
      label: authenticated ? 'Profile' : 'Sign in',
      icon: UserIcon,
      match: (p) => p.startsWith('/profile') || p.startsWith('/login'),
    },
  ]
}

type NavProps = { authenticated?: boolean; translucent?: boolean; avatar?: NavAvatar }

export const NAV_AVATAR_CACHE = 'reelset:nav-avatar'

/** Server layouts pass the avatar; the feed does not, so it is fetched once and kept per tab. */
function useNavAvatar(authenticated: boolean, provided: NavAvatar | undefined) {
  const [fetched, setFetched] = useState<NavAvatar | null>(null)
  useEffect(() => {
    if (!authenticated || provided) return
    try {
      const cached = sessionStorage.getItem(NAV_AVATAR_CACHE)
      if (cached) {
        setFetched(JSON.parse(cached) as NavAvatar)
        return
      }
    } catch {}
    let live = true
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { avatarUrl: string | null; initial: string } | null) => {
        if (!live || !data) return
        const value = { url: data.avatarUrl, initial: data.initial }
        setFetched(value)
        try {
          sessionStorage.setItem(NAV_AVATAR_CACHE, JSON.stringify(value))
        } catch {}
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [authenticated, provided])
  return authenticated ? (provided ?? fetched) : null
}

function TabIcon({
  Icon,
  avatar,
  className,
  avatarClass,
}: {
  Icon: Tab['icon']
  avatar: NavAvatar | null
  className: string
  avatarClass: string
}) {
  if (!avatar) return <Icon className={className} />
  return <Avatar url={avatar.url} initial={avatar.initial} className={avatarClass} />
}

export function SideNav({ authenticated = false, avatar }: NavProps) {
  const path = usePathname()
  const navAvatar = useNavAvatar(authenticated, avatar)
  return (
    <nav aria-label="Main" className="mt-8 flex flex-col gap-1 text-sm">
      {tabs(path, authenticated).map(({ href, label, icon: Icon, match }) => {
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
            <TabIcon
              Icon={Icon}
              avatar={label === 'Profile' ? navAvatar : null}
              className="h-[18px] w-[18px]"
              avatarClass="h-[22px] w-[22px] -mx-0.5 text-[11px]"
            />
            {label}
          </a>
        )
      })}
    </nav>
  )
}

export function BottomTabs({ authenticated = false, translucent = false, avatar }: NavProps) {
  const path = usePathname()
  const navAvatar = useNavAvatar(authenticated, avatar)
  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 bottom-0 z-40 grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-4 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden ${
        translucent ? 'border-white/10 bg-black/45 backdrop-blur-md' : 'border-line bg-bg/95'
      }`}
    >
      {tabs(path, authenticated).map(({ href, label, icon: Icon, match }) => {
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
            <TabIcon
              Icon={Icon}
              avatar={label === 'Profile' ? navAvatar : null}
              className="h-5 w-5"
              avatarClass="h-5 w-5 text-[10px]"
            />
            {label}
          </a>
        )
      })}
    </nav>
  )
}
