import { interpolate, useCurrentFrame } from 'remotion'
import { useSpring } from './fx'
import { fitText } from './lib/text'
import { COLOR, CONTENT_TOP, CONTENT_W, FONT } from './theme'

/** 0-3 s hook card: huge uppercase text in an accent slab, top third, gone at its cue. */
export function Headline({ text, frames }: { text: string; frames: number }) {
  const frame = useCurrentFrame()
  const s = useSpring(0, 12, 0.5)
  const out = interpolate(frame, [frames - 5, frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const label = text.toUpperCase()
  const size = fitText(label, { width: CONTENT_W - 80, height: 190 }, { min: 56, max: 96, charWidth: 0.6, lineHeight: 1.04 })
  return (
    <div
      style={{
        position: 'absolute',
        left: 56,
        right: 130,
        top: CONTENT_TOP + 6,
        transform: `scale(${interpolate(s, [0, 1], [0.7, 1])}) translateY(${(1 - out) * -30}px)`,
        transformOrigin: '50% 0%',
        opacity: out,
        background: COLOR.accent,
        color: COLOR.accentInk,
        borderRadius: 28,
        padding: '30px 40px',
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.04,
        letterSpacing: '-0.035em',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        minHeight: 100,
      }}
    >
      {label}
    </div>
  )
}
