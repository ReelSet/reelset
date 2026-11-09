import { useMemo } from 'react'
import { useCurrentFrame } from 'remotion'
import { Rise } from '../fx'
import { Card } from '../Media'
import { codeMetrics, sliceTokens, tokenize, type TokenKind } from '../lib/highlight'
import { COLOR, CONTENT_W, FONT, MONO, SAFE, SCENE_H, SCENE_TOP } from '../theme'

const TOKEN_COLOR: Record<TokenKind, string> = {
  keyword: COLOR.accent,
  string: '#8cc8ff',
  number: '#ffa266',
  comment: '#6b6b74',
  call: '#f4f4f5',
  type: '#b9b4ff',
  plain: '#d4d4d8',
}

export function CodeScene({
  language,
  code,
  frames,
}: {
  language: string
  code: string
  frames: number
}) {
  const frame = useCurrentFrame()
  const tokens = useMemo(() => tokenize(code), [code])
  const metrics = useMemo(() => codeMetrics(code, CONTENT_W - 56, SCENE_H - 150), [code])
  const typed = Math.min(
    code.length,
    Math.floor(Math.max(0, frame - 8) * (code.length / Math.max(20, frames * 0.62))),
  )
  const done = typed >= code.length
  const caretOn = done ? Math.floor(frame / 15) % 2 === 0 : true
  const shown = sliceTokens(tokens, typed)
  const height = Math.min(
    SCENE_H - 40,
    Math.max(240, Math.round(metrics.lines * metrics.size * 1.55) + 120),
  )
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: SCENE_TOP + (SCENE_H - height) / 2,
        width: CONTENT_W,
      }}
    >
      <Rise>
        <Card width={CONTENT_W} height={height} style={{ background: '#0e0e11' }}>
          <div
            style={{
              height: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 22px',
              borderBottom: `1px solid ${COLOR.line}`,
            }}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              {['#3a3a42', '#3a3a42', '#3a3a42'].map((c, i) => (
                <div key={i} style={{ width: 11, height: 11, borderRadius: 6, background: c }} />
              ))}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: COLOR.muted }}>
              {language}
            </div>
          </div>
          <pre
            style={{
              margin: 0,
              padding: '22px 28px',
              fontFamily: MONO,
              fontSize: metrics.size,
              lineHeight: 1.55,
              whiteSpace: metrics.wrap ? 'pre-wrap' : 'pre',
              overflowWrap: 'anywhere',
              overflow: 'hidden',
            }}
          >
            {shown.map((t, i) => (
              <span
                key={i}
                style={{
                  color: TOKEN_COLOR[t.kind],
                  fontWeight: t.kind === 'call' || t.kind === 'keyword' ? 600 : 400,
                }}
              >
                {t.text}
              </span>
            ))}
            <span
              style={{
                display: 'inline-block',
                width: Math.round(metrics.size * 0.55),
                height: metrics.size * 1.1,
                marginLeft: 2,
                verticalAlign: 'text-bottom',
                background: COLOR.accent,
                opacity: caretOn ? 0.9 : 0,
              }}
            />
          </pre>
        </Card>
      </Rise>
    </div>
  )
}
