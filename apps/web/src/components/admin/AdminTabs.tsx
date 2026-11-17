'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeTabHref, type AdminTab } from '@/lib/admin/nav'

/** Underlined link tabs for one admin group; the current route carries aria-current. */
export function AdminTabs({ tabs, label }: { tabs: readonly AdminTab[]; label: string }) {
  const pathname = usePathname()
  const activeHref = activeTabHref(pathname, tabs)
  return (
    <nav
      aria-label={label}
      className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 lg:mx-0 lg:px-0"
    >
      <ul className="flex min-w-max gap-5 border-b border-line">
        {tabs.map((tab) => {
          const active = tab.href === activeHref
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative -mb-px block whitespace-nowrap py-2.5 text-[13px] transition ${
                  active
                    ? 'border-b-2 border-accent font-medium text-fg'
                    : 'border-b-2 border-transparent text-muted hover:text-fg'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
