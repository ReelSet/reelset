'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavLink = { href: string; label: string }

export function AdminNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname()
  const current = pathname.replace(/^\/admin(?=\/|$)/, '') || '/'
  const isActive = (href: string) => {
    const target = href.replace(/^\/admin(?=\/|$)/, '') || '/'
    return target === '/' ? current === '/' : current.startsWith(target)
  }
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(link.href) ? 'page' : undefined}
          className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] transition ${
            isActive(link.href)
              ? 'bg-raised text-fg'
              : 'text-muted hover:bg-raised/60 hover:text-fg'
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
