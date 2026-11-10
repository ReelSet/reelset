import { useMemo } from 'react'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { highlightIndex, pageAt, toPages } from './lib/captions'
import { typeset } from './lib/typeset'
import type { Word } from './lib/types'
import {
  CAPTION_FONT,
  CAPTION_H,
  CAPTION_LEFT,
  CAPTION_LINE_HEIGHT,
  CAPTION_TOP,
  CAPTION_W,
  COLOR,
  FONT,
} from './theme'

/** House style: heavy white text with a black outline, the spoken word in an accent box. */
export function Captions({ words }: { words: Word[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const pages = useMemo(() => toPages(words, 3, 22), [words])
  const page = pageAt(pages, t, 0.2)
  if (!page) return null
  const first = page[0]?.start ?? 0
  const lit = highlightIndex(page, t)
  const pop = interpolate(t - first, [0, 0.1], [0.86, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <div
      style={{
        position: 'absolute',
        left: CAPTION_LEFT,
        top: CAPTION_TOP,
        width: CAPTION_W,
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
          fontWeight: 900,
          fontSize: CAPTION_FONT,
          lineHeight: CAPTION_LINE_HEIGHT,
          letterSpacing: '-0.02em',
          transform: `scale(${pop})`,
        }}
      >
        {page.map((word, i) => {
          const active = i === lit
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                padding: '0 12px',
                margin: '2px',
                borderRadius: 16,
                background: active ? COLOR.accent : 'transparent',
                color: active ? COLOR.accentInk : '#fff',
                WebkitTextStroke: active ? undefined : '10px #000',
                paintOrder: 'stroke fill',
                textShadow: active ? undefined : '0 6px 24px rgba(0,0,0,0.5)',
              }}
            >
              {typeset(word.text)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
