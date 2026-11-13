type P = { className?: string }

function Svg({ className = 'h-4 w-4', children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
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

export const CopyIcon = ({ className }: P) => (
  <Svg className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </Svg>
)

export const CheckIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)

export const RefreshIcon = ({ className }: P) => (
  <Svg className={className}>
    <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.5L20 15.5" />
    <path d="M20 20v-4.5h-4.5" />
  </Svg>
)
