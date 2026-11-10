import { GITHUB_URL, INSTAGRAM_URL } from '@/lib/links'
import { GithubIcon, InstagramIcon } from './icons'

const LINKS = [
  {
    href: GITHUB_URL,
    label: 'GitHub',
    title: 'Reelset is open source on GitHub',
    Icon: GithubIcon,
  },
  {
    href: INSTAGRAM_URL,
    label: 'Instagram',
    title: 'Follow @reelset.app on Instagram',
    Icon: InstagramIcon,
  },
]

export function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex items-center gap-2 ${className}`}>
      {LINKS.map(({ href, label, title, Icon }) => (
        <li key={label}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-raised hover:text-fg active:scale-95"
          >
            <Icon className="h-4 w-4" />
            {label}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function CommunityRows() {
  return (
    <div className="flex flex-col gap-2">
      {LINKS.map(({ href, title, Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center gap-3 rounded-md border border-line bg-surface px-4 text-sm transition hover:bg-raised active:scale-[0.99]"
        >
          <Icon className="h-[18px] w-[18px] text-muted" />
          {title}
          <span aria-hidden className="ml-auto text-faint">
            ↗
          </span>
        </a>
      ))}
    </div>
  )
}
