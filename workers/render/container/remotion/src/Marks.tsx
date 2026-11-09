import type { CSSProperties } from 'react'
import { COLOR, FONT } from './theme'
import type { Source } from './lib/types'

type MarkProps = { size?: number }

export function Glyph({ source, size }: { source: Source; size: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' } as const
  switch (source) {
    case 'hn':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="5" fill="#ff6600" />
          <path
            d="M7 6.5 12 13.5 17 6.5M12 13.5V18"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'github':
      return (
        <svg {...common}>
          <circle cx="6.5" cy="5.5" r="2.2" stroke="#f4f4f5" strokeWidth="1.8" />
          <circle cx="6.5" cy="18.5" r="2.2" stroke="#f4f4f5" strokeWidth="1.8" />
          <circle cx="17.5" cy="9.5" r="2.2" stroke="#f4f4f5" strokeWidth="1.8" />
          <path
            d="M6.5 7.7v8.6M17.5 11.7c0 3-3.5 3.3-9.2 5.5"
            stroke="#f4f4f5"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'reddit':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="#ff4500" />
          <text
            x="12"
            y="16.2"
            textAnchor="middle"
            fontFamily={FONT}
            fontWeight="800"
            fontSize="12"
            fill="#fff"
          >
            r/
          </text>
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common}>
          <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="#ff0033" />
          <path d="M10 9v6l5.2-3z" fill="#fff" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <rect
            x="3"
            y="3.5"
            width="18"
            height="17"
            rx="3"
            stroke={COLOR.accent}
            strokeWidth="1.8"
          />
          <path
            d="M7 8.5h10M7 12h10M7 15.5h6"
            stroke={COLOR.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}

export function SourceChip({
  source,
  label,
  size = 1,
  style,
}: {
  source: Source
  label: string
  size?: number
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10 * size,
        height: 36 * size,
        padding: `0 ${14 * size}px 0 ${10 * size}px`,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.06)',
        border: `1px solid ${COLOR.line}`,
        fontFamily: FONT,
        fontWeight: 600,
        fontSize: 16 * size,
        letterSpacing: '0.01em',
        color: COLOR.text,
        ...style,
      }}
    >
      <Glyph source={source} size={20 * size} />
      {label}
    </div>
  )
}

export function Wordmark({ size = 1 }: MarkProps & { size?: number }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8 * size,
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: 17 * size,
        letterSpacing: '-0.01em',
        color: COLOR.text,
      }}
    >
      <span
        style={{
          width: 10 * size,
          height: 10 * size,
          borderRadius: 3 * size,
          background: COLOR.accent,
          display: 'inline-block',
        }}
      />
      reelset
    </div>
  )
}
