type P = { className?: string }

function Svg({
  className = 'h-6 w-6',
  children,
  fill = 'none',
}: P & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export const HeartIcon = ({ className, filled }: P & { filled?: boolean }) => (
  <Svg className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20.5s-7.5-4.6-9-9.6C2 7.5 4.2 4.8 7.1 4.8c1.9 0 3.5 1 4.9 3 1.4-2 3-3 4.9-3 2.9 0 5.1 2.7 4.1 6.1-1.5 5-9 9.6-9 9.6z" />
  </Svg>
)
export const BookmarkIcon = ({ className, filled }: P & { filled?: boolean }) => (
  <Svg className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4.5L5.5 21V4.5a1 1 0 0 1 1-1z" />
  </Svg>
)
export const ClockIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
)
export const TrashIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
)
export const LayersIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
)
export const ShareIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </Svg>
)
export const VolumeIcon = ({ className, muted }: P & { muted?: boolean }) => (
  <Svg className={className}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <path d="M16 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />
    )}
  </Svg>
)
export const PlayIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M8 5.5v13l10.5-6.5z" />
  </svg>
)
export const ChevronIcon = ({ className, dir = 'down' }: P & { dir?: 'up' | 'down' }) => (
  <Svg className={className}>
    <path d={dir === 'down' ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
  </Svg>
)
export const SearchIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </Svg>
)
export const UserIcon = ({ className }: P) => (
  <Svg className={className}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
  </Svg>
)
export const CloseIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
)
export const ArrowUpRightIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Svg>
)
export const ArrowRightIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </Svg>
)
export const SparkleIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 3.5c.6 4.5 2 5.9 6.5 6.5-4.5.6-5.9 2-6.5 6.5-.6-4.5-2-5.9-6.5-6.5C10 9.4 11.4 8 12 3.5zM18.5 16c.3 2 1 2.7 3 3-2 .3-2.7 1-3 3-.3-2-1-2.7-3-3 2-.3 2.7-1 3-3z" />
  </Svg>
)
export const HashIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15" />
  </Svg>
)
export const HomeIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="6" y="3" width="12" height="18" rx="3" />
    <path d="m10.5 9.5 3.5 2.5-3.5 2.5z" fill="currentColor" />
  </Svg>
)
export const WarnIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5m0 2.5v.01" />
  </Svg>
)
export const PaperIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M7 3.5h7.5L19 8v12.5H7z" />
    <path d="M14.5 3.5V8H19M10 12.5h6M10 16h6" />
  </Svg>
)
export const GithubIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </Svg>
)
export const InstagramIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17.5 6.5h.01" />
  </Svg>
)

export const EyeIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
)
