import type { CSSProperties, ReactNode } from 'react'
import { COLOR } from './theme'

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
