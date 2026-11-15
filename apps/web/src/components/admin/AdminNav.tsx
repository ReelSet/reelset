'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  GridIcon,
  InstagramIcon,
  PipelineIcon,
  SlidersIcon,
  SparkleIcon,
} from '@/components/ui/icons'
import {
  NAV_GROUPS,
  isGroupActive,
  type AdminIcon,
  type NavBadges,
  type NavGroup,
} from '@/lib/admin/nav'

type Variant = 'sidebar' | 'bottom'

const ICONS: Record<AdminIcon, (props: { className?: string }) => React.ReactNode> = {
  overview: GridIcon,
  pipeline: PipelineIcon,
  generate: SparkleIcon,
  instagram: InstagramIcon,
  settings: SlidersIcon,
}

const MAX_BADGE = 99

function badgeCount(group: NavGroup, badges: NavBadges): number {
  return group.badge ? (badges[group.badge] ?? 0) : 0
}

function Badge({ count, variant }: { count: number; variant: Variant }) {
  if (count <= 0) return null
  const text = count > MAX_BADGE ? `${MAX_BADGE}+` : String(count)
  const position = variant === 'bottom' ? 'absolute -right-2.5 -top-1.5' : 'ml-auto'
  return (
    <span
      className={`${position} min-w-4 rounded-full bg-warn/20 px-1 text-center text-[10px] font-medium leading-4 tabular-nums text-warn`}
    >
      <span className="sr-only">{`${text} need attention in `}</span>
      {text}
    </span>
  )
}

function NavItem({
  group,
  active,
  count,
  variant,
}: {
  group: NavGroup
  active: boolean
  count: number
  variant: Variant
}) {
  const Icon = ICONS[group.icon]
  const layout =
    variant === 'sidebar'
      ? 'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]'
      : 'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]'
  const tone = active
    ? 'text-fg ' + (variant === 'sidebar' ? 'bg-raised' : '')
    : 'text-muted hover:text-fg ' + (variant === 'sidebar' ? 'hover:bg-raised/60' : '')
  return (
    <Link
      href={group.href}
      aria-current={active ? 'page' : undefined}
      className={`${layout} ${tone} transition`}
    >
      <span className="relative">
        <Icon className={`size-[18px] ${active ? 'text-accent' : ''}`} />
        {variant === 'bottom' && <Badge count={count} variant={variant} />}
      </span>
      {group.label}
      {variant === 'sidebar' && <Badge count={count} variant={variant} />}
    </Link>
  )
}

/** The five admin entries; `sidebar` is grouped by section, `bottom` is the mobile tab bar. */
export function AdminNav({ badges, variant }: { badges: NavBadges; variant: Variant }) {
  const pathname = usePathname()
  const items = (list: readonly NavGroup[]) =>
    list.map((group) => (
      <NavItem
        key={group.key}
        group={group}
        active={isGroupActive(pathname, group)}
        count={badgeCount(group, badges)}
        variant={variant}
      />
    ))

  if (variant === 'bottom') {
    return (
      <nav
        aria-label="Admin"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {items(NAV_GROUPS)}
      </nav>
    )
  }
  const sections = [...new Set(NAV_GROUPS.map((g) => g.section))]
  return (
    <nav aria-label="Admin" className="hidden flex-col gap-5 lg:flex">
      {sections.map((section) => (
        <div key={section} className="flex flex-col gap-0.5">
          <p className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-wider text-faint">
            {section}
          </p>
          {items(NAV_GROUPS.filter((g) => g.section === section))}
        </div>
      ))}
    </nav>
  )
}
