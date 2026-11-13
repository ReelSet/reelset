import { SideNav } from '@/components/ui/AppNav'
import { Wordmark } from '@/components/ui/Logo'
import { SocialLinks } from '@/components/ui/SocialLinks'
import { SourceDot, SOURCES } from '@/components/ui/sources'

type Props = { authenticated?: boolean; avatar?: { url: string | null; initial: string } }

/** The one desktop left rail. Feed and AppShell both render it so nothing shifts between pages. */
export function SideRail({ authenticated = false, avatar }: Props) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col justify-between px-8 py-10 lg:flex">
      <div>
        <a href="/" aria-label="Reelset home">
          <Wordmark className="text-lg" />
        </a>
        <p className="mt-4 max-w-[14rem] text-sm leading-relaxed text-muted">
          What developers are building, in 60-second reels.
        </p>
        <SideNav authenticated={authenticated} avatar={avatar} />
      </div>
      <div className="flex flex-col gap-6">
        <ul className="flex flex-col gap-2 text-xs text-faint">
          {Object.entries(SOURCES).map(([key, s]) => (
            <li key={key} className="flex items-center gap-2">
              <SourceDot source={key} />
              {s.label}
            </li>
          ))}
        </ul>
        <SocialLinks />
      </div>
    </aside>
  )
}
