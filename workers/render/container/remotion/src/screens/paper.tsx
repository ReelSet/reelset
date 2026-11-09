import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { continueRender, delayRender, interpolate, useCurrentFrame } from 'remotion'
import { Pop, Rise, easeOut } from '../fx'
import { formatStat, parseStat } from '../lib/count'
import { clipWords, columnWidths, fitLabel, plainText, readTable, rowHeight } from '../lib/table'
import { fitText } from '../lib/text'
import { COLOR, CONTENT_W, LOW_TOP, CONTENT_TOP, MONO, ZONE_H } from '../theme'
import { Chip, Page, prop, useCount, type ScreenProps } from './ui'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function TableScreen({ frames, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const table = readTable(props)
  const count = useCount(frames, 0.5, 16)
  if (!table) return <Page frames={frames} topPad={topPad} />

  const avail = ZONE_H - topPad
  const rh = rowHeight(avail, table.rows.length)
  const widths = columnWidths(table.headers.length, CONTENT_W)
  const sweep = easeOut(
    interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  const stat = parseStat(table.value)
  const shown = stat ? formatStat(stat, count) : table.value
  const valueSize = fitText(
    table.value || '0',
    { width: CONTENT_W, height: 120 },
    { min: 70, max: 130, charWidth: 0.62, lineHeight: 1 },
  )

  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          position: 'relative',
          height: avail,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <Pop>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Chip size={30} bg={COLOR.accent} color={COLOR.accentInk}>
              {table.ref.toUpperCase()}
            </Chip>
            <div
              style={{
                fontSize: 28,
                color: COLOR.muted,
                fontWeight: 600,
                lineHeight: 1.2,
                flex: 1,
              }}
            >
              {clipWords(plainText(table.caption), 80)}
            </div>
          </div>
        </Pop>
        <div
          style={{
            marginTop: 26,
            borderRadius: 32,
            background: COLOR.surface,
            border: `2px solid ${COLOR.line}`,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              height: 96,
              alignItems: 'flex-end',
              paddingBottom: 14,
              borderBottom: `2px solid ${COLOR.line}`,
            }}
          >
            {table.headers.map((h, c) => (
              <div
                key={c}
                style={{
                  width: widths[c],
                  boxSizing: 'border-box',
                  padding: c === 0 ? '0 0 0 28px' : '0 10px',
                  textAlign: c === 0 ? 'left' : 'center',
                  fontSize: 24,
                  lineHeight: 1.1,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: c === table.col ? COLOR.accent : COLOR.muted,
                }}
              >
                {clip(h, 22)}
              </div>
            ))}
          </div>
          {table.rows.map((row, r) => {
            const isHi = r === table.hi
            return (
              <Pop key={r} delay={4 + r * 3}>
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    height: rh,
                    borderTop: r === 0 ? 'none' : `1px solid ${COLOR.line}`,
                  }}
                >
                  {isHi ? (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${sweep * 100}%`,
                        background:
                          'linear-gradient(90deg, rgba(200,247,81,0.30), rgba(200,247,81,0.12))',
                        borderLeft: `8px solid ${COLOR.accent}`,
                      }}
                    />
                  ) : null}
                  {row.map((cell, c) => {
                    const isBest = table.best.has(`${r}:${c}`)
                    const isKey = isHi && c === table.col
                    const text = isKey && stat ? shown : cell
                    return (
                      <div
                        key={c}
                        style={{
                          position: 'relative',
                          width: widths[c],
                          boxSizing: 'border-box',
                          padding: c === 0 ? '0 8px 0 28px' : '0 10px',
                          textAlign: c === 0 ? 'left' : 'center',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontSize:
                            c === 0
                              ? fitLabel(cell, widths[0]! - 36, Math.min(44, rh * 0.45), 24)
                              : Math.min(54, Math.round(rh * 0.5)),
                          fontWeight: isBest || isHi ? 900 : c === 0 ? 700 : 600,
                          color:
                            isBest || isKey
                              ? COLOR.accent
                              : isHi && c === 0
                                ? COLOR.text
                                : c === 0
                                  ? '#e4e4e7'
                                  : '#d4d4d8',
                          fontVariantNumeric: 'tabular-nums',
                          letterSpacing: '-0.02em',
                          textShadow: isKey ? '0 0 36px rgba(200,247,81,0.55)' : undefined,
                        }}
                      >
                        {text}
                      </div>
                    )
                  })}
                </div>
              </Pop>
            )
          })}
        </div>
      </div>
      {table.value ? (
        <Rise
          delay={14}
          style={{
            position: 'absolute',
            left: 0,
            top: LOW_TOP - CONTENT_TOP - topPad + 6,
            width: CONTENT_W,
          }}
        >
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: COLOR.muted,
            }}
          >
            {clip(table.label, 34)}
          </div>
          <div
            style={{
              fontSize: valueSize,
              fontWeight: 900,
              lineHeight: 1,
              letterSpacing: '-0.05em',
              color: COLOR.accent,
              fontVariantNumeric: 'tabular-nums',
              textShadow: '0 0 70px rgba(200,247,81,0.4)',
            }}
          >
            {shown}
          </div>
        </Rise>
      ) : null}
    </Page>
  )
}

const KATEX_FONTS = ['KaTeX_Main', 'KaTeX_Math', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_AMS']

function useKatexFonts(): boolean {
  const [handle] = useState(() => delayRender('katex fonts'))
  const [ready, setReady] = useState(false)
  useEffect(() => {
    Promise.all(KATEX_FONTS.map((f) => document.fonts.load(`40px ${f}`).catch(() => [])))
      .catch(() => undefined)
      .finally(() => {
        setReady(true)
        continueRender(handle)
      })
  }, [handle])
  return ready
}

export function renderLatex(latex: string): string | null {
  try {
    const html = katex.renderToString(latex, {
      displayMode: true,
      throwOnError: true,
      output: 'html',
      strict: 'ignore',
      trust: false,
      maxSize: 20,
      maxExpand: 200,
    })
    return html
  } catch {
    return null
  }
}

export function EquationScreen({ frames, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const latex = prop<string>(props, 'latex', '')
  const label = prop<string>(props, 'label', '')
  const html = useMemo(() => renderLatex(latex), [latex])
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const fontsReady = useKatexFonts()
  const maxW = CONTENT_W - 96
  useLayoutEffect(() => {
    const el = box.current
    if (el) setScale(el.offsetWidth > maxW ? maxW / el.offsetWidth : 1)
  }, [html, maxW, fontsReady])
  const sweep = easeOut(
    interpolate(frame, [8, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  )
  const size = latex.length > 110 ? 56 : latex.length > 70 ? 68 : 84
  if (!latex) return <Page frames={frames} topPad={topPad} />
  const avail = ZONE_H - topPad
  return (
    <Page frames={frames} topPad={topPad}>
      <div
        style={{
          height: avail,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 36,
        }}
      >
        <Pop>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <Chip size={32} bg={COLOR.accent} color={COLOR.accentInk}>
              KEY EQUATION
            </Chip>
            {label ? (
              <span style={{ fontSize: 34, fontWeight: 800, color: COLOR.muted }}>
                {clip(label, 40)}
              </span>
            ) : null}
          </div>
        </Pop>
        <Pop delay={4}>
          <div
            style={{
              borderRadius: 36,
              background: COLOR.surface,
              border: `2px solid ${COLOR.line}`,
              padding: '64px 48px 56px',
              position: 'relative',
              overflow: 'hidden',
              minHeight: 300,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: maxW, display: 'flex', justifyContent: 'center' }}>
              <div
                ref={box}
                style={{
                  display: 'inline-block',
                  fontSize: size,
                  color: COLOR.text,
                  transform: `scale(${scale})`,
                  transformOrigin: '50% 50%',
                  whiteSpace: 'nowrap',
                }}
              >
                {html ? (
                  <div dangerouslySetInnerHTML={{ __html: html }} style={{ margin: 0 }} />
                ) : (
                  <code style={{ fontFamily: MONO, fontSize: 40, whiteSpace: 'pre-wrap' }}>
                    {latex}
                  </code>
                )}
              </div>
            </div>
            <div
              style={{
                height: 8,
                width: `${sweep * 100}%`,
                background: COLOR.accent,
                borderRadius: 4,
                marginTop: 44,
                alignSelf: 'flex-start',
              }}
            />
          </div>
        </Pop>
      </div>
    </Page>
  )
}
