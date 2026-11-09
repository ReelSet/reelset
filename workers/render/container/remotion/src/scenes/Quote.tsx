import { Rise, useSpring } from '../fx'
import { fitText } from '../lib/text'
import { COLOR, CONTENT_W, FONT, SAFE, SCENE_H, SCENE_TOP } from '../theme'

export function QuoteScene({ text, attribution }: { text: string; attribution: string }) {
  const size = fitText(
    text,
    { width: CONTENT_W - 8, height: 380 },
    { min: 28, max: 46, lineHeight: 1.22 },
  )
  const bar = useSpring(2, 20, 0.9)
  const initial =
    attribution
      .replace(/^[^A-Za-z0-9]+/, '')
      .charAt(0)
      .toUpperCase() || '?'
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: SCENE_TOP,
        width: CONTENT_W,
        height: SCENE_H,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <Rise>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 150,
            lineHeight: 0.7,
            height: 70,
            color: COLOR.accent,
          }}
        >
          &ldquo;
        </div>
      </Rise>
      <div style={{ display: 'flex', gap: 22, marginTop: 14 }}>
        <div
          style={{
            width: 4,
            borderRadius: 2,
            background: COLOR.accent,
            transformOrigin: 'top',
            transform: `scaleY(${bar})`,
            opacity: 0.8,
          }}
        />
        <Rise delay={4} style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: size,
              lineHeight: 1.22,
              letterSpacing: '-0.025em',
              color: COLOR.text,
            }}
          >
            {text}
          </div>
        </Rise>
      </div>
      <Rise delay={12} style={{ marginTop: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              background: COLOR.surface2,
              border: `1px solid ${COLOR.line}`,
              color: COLOR.accent,
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {initial}
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 24,
              color: COLOR.muted,
              maxWidth: CONTENT_W - 70,
            }}
          >
            {attribution.replace(/^[\s—–-]+/, '')}
          </div>
        </div>
      </Rise>
    </div>
  )
}
