import type { ReactNode } from 'react'
import { useCurrentFrame } from 'remotion'
import { rng } from '../lib/art'
import { COLOR, MONO } from '../theme'
import { clamp, ink, lime, type ArtProps } from './kit'

type Line = { kind: 'cmd'; text: string } | { kind: 'out'; node: ReactNode } | { kind: 'bar' }

const SIZE = 20
const LINE_H = 35
const HEAD_H = 46
const CHARS_PER_FRAME = 0.9
const BAR_FRAMES = 22

function script(tool: string, seed: number): Line[] {
  const r = rng(seed)
  const files = 8 + Math.floor(r() * 30)
  const secs = (0.6 + r() * 2.2).toFixed(1)
  const port = 3000 + Math.floor(r() * 5000)
  const ok = (t: string): ReactNode => (
    <>
      <span style={{ color: COLOR.accent }}>✓</span> <span style={{ color: ink(0.62) }}>{t}</span>
    </>
  )
  return [
    { kind: 'cmd', text: `npx ${tool} init` },
    { kind: 'out', node: ok(`scaffolded ${files} files`) },
    { kind: 'cmd', text: `${tool} build --release` },
    { kind: 'bar' },
    { kind: 'out', node: ok(`built in ${secs}s`) },
    { kind: 'cmd', text: `${tool} serve` },
    {
      kind: 'out',
      node: (
        <>
          <span style={{ color: COLOR.accent }}>●</span>{' '}
          <span style={{ color: ink(0.62) }}>ready on :{port}</span>
        </>
      ),
    },
  ]
}

export function Terminal({ w, h, seed, tool }: ArtProps) {
  const frame = useCurrentFrame()
  const fit = Math.max(2, Math.floor((h - HEAD_H - 28) / LINE_H))
  const lines = script(tool, seed).slice(0, fit)
  const rows: { at: number; end: number; line: Line }[] = []
  let t = 8
  for (const line of lines) {
    const dur =
      line.kind === 'cmd'
        ? Math.ceil(line.text.length / CHARS_PER_FRAME)
        : line.kind === 'bar'
          ? BAR_FRAMES
          : 4
    rows.push({ at: t, end: t + dur, line })
    t += dur + (line.kind === 'cmd' ? 7 : 5)
  }
  const active = rows.findIndex((r) => frame < r.end)
  const caretRow = active === -1 ? rows.length - 1 : active
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0d0d10' }}>
      <div
        style={{
          height: HEAD_H,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          gap: 8,
          borderBottom: `1px solid ${COLOR.line}`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 11, height: 11, borderRadius: 6, background: '#34343b' }} />
        ))}
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: MONO,
            fontSize: 13,
            color: COLOR.dim,
            marginRight: 50,
          }}
        >
          ~/{tool}
        </div>
      </div>
      <div
        style={{
          padding: '18px 26px',
          fontFamily: MONO,
          fontSize: SIZE,
          lineHeight: `${LINE_H}px`,
        }}
      >
        {rows.map((row, i) => {
          if (frame < row.at) return null
          const { line } = row
          if (line.kind === 'cmd') {
            const n = Math.min(line.text.length, Math.floor((frame - row.at) * CHARS_PER_FRAME))
            const caret = i === caretRow && Math.floor(frame / 14) % 2 === 0
            return (
              <div key={i} style={{ whiteSpace: 'pre', color: ink(0.92) }}>
                <span style={{ color: COLOR.accent }}>$ </span>
                {line.text.slice(0, n)}
                {caret ? (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 9,
                      height: 19,
                      marginLeft: 2,
                      verticalAlign: 'text-bottom',
                      background: COLOR.accent,
                      opacity: 0.9,
                    }}
                  />
                ) : null}
              </div>
            )
          }
          if (line.kind === 'bar') {
            const p = clamp((frame - row.at) / BAR_FRAMES)
            return (
              <div
                key={i}
                style={{ display: 'flex', alignItems: 'center', height: LINE_H, gap: 14 }}
              >
                <div
                  style={{
                    width: Math.min(260, w - 150),
                    height: 8,
                    borderRadius: 4,
                    background: ink(0.1),
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ width: `${p * 100}%`, height: '100%', background: COLOR.accent }} />
                </div>
                <span style={{ color: ink(0.5), fontSize: 15 }}>{Math.round(p * 100)}%</span>
              </div>
            )
          }
          return (
            <div key={i} style={{ opacity: clamp((frame - row.at) / 4), whiteSpace: 'pre' }}>
              {line.node}
            </div>
          )
        })}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: HEAD_H,
          width: 120,
          height: 120,
          background: `radial-gradient(closest-side, ${lime(0.07)}, ${lime(0)})`,
        }}
      />
    </div>
  )
}
