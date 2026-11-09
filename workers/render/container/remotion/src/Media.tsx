import type { CSSProperties, ReactNode } from 'react'
import { Img, staticFile } from 'remotion'
import { COLOR } from './theme'
import { Glyph } from './Marks'
import type { Source } from './lib/types'
import { KenBurns } from './fx'

export const asset = (file: string) => staticFile(file)

export function Card({
  width,
  height,
  children,
  style,
}: {
  width: number
  height: number
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 28,
        overflow: 'hidden',
        background: COLOR.surface,
        border: `1px solid ${COLOR.line}`,
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// Hero media with a fallback chain, so a reel never shows a hole: file -> generated cover.
export function Hero({
  file,
  frames,
  source,
}: {
  file?: string
  frames: number
  source: Source
  sourceLabel?: string
  title?: string
}) {
  if (file) {
    return (
      <>
        <KenBurns frames={frames}>
          <Img src={asset(file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </KenBurns>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to bottom, rgba(9,9,11,0) 55%, rgba(9,9,11,0.55))',
          }}
        />
      </>
    )
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(90% 80% at 80% 0%, rgba(200,247,81,0.22), rgba(200,247,81,0) 62%), radial-gradient(70% 70% at 10% 100%, rgba(120,140,255,0.16), rgba(120,140,255,0) 65%), #121215',
      }}
    >
      <div style={{ opacity: 0.9, transform: 'scale(1)' }}>
        <Glyph source={source} size={132} />
      </div>
    </div>
  )
}
