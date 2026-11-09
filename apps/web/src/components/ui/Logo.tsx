export function LogoMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect
        x="214"
        y="88"
        width="204"
        height="316"
        rx="44"
        transform="rotate(9 316 246)"
        fill="none"
        stroke="#c8f751"
        strokeOpacity=".4"
        strokeWidth="18"
      />
      <rect x="132" y="108" width="214" height="326" rx="46" fill="#c8f751" />
      <path d="M212 232v108l92-54z" fill="#0b0d04" />
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <LogoMark />
      Reelset
    </span>
  )
}
