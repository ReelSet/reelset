import { useMemo } from 'react'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { pageAt, toPages } from './lib/captions'
import type { Word } from './lib/types'
import { CAPTION_H, CAPTION_TOP, COLOR, CONTENT_W, FONT, SAFE } from './theme'

export function Captions({ words }: { words: Word[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const pages = useMemo(() => toPages(words), [words])
  const page = pageAt(pages, t)
  if (!page) return null
  const first = page[0]?.start ?? 0
  const enter = interpolate(t - first, [0, 0.14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: CAPTION_TOP,
        width: CONTENT_W,
        height: CAPTION_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: 46,
          lineHeight: 1.18,
          letterSpacing: '-0.02em',
          opacity: enter,
          transform: `translateY(${(1 - enter) * 10}px)`,
          textShadow: '0 2px 18px rgba(0,0,0,0.7)',
        }}
      >
        {page.map((word, i) => {
          const spoken = t >= word.end
          const active = t >= word.start && t < word.end
          return (
            <span
              key={i}
              style={{
                color: active ? COLOR.accent : spoken ? COLOR.text : 'rgba(244,244,245,0.42)',
                display: 'inline-block',
                marginRight: i < page.length - 1 ? '0.26em' : 0,
                transform: active ? 'translateY(-2px)' : undefined,
              }}
            >
              {word.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
