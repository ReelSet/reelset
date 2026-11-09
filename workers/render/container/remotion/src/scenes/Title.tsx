import { Rise, useSpring } from '../fx'
import { fitText } from '../lib/text'
import { COLOR, CONTENT_W, FONT, MONO, SAFE, SCENE_H, SCENE_TOP } from '../theme'

export function TitleScene({
  title,
  subtitle,
  index,
}: {
  title: string
  subtitle?: string
  index: number
}) {
  const size = fitText(
    title,
    { width: CONTENT_W, height: 330 },
    { min: 40, max: 80, lineHeight: 1.06 },
  )
  const line = useSpring(4, 20, 0.9)
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
      <div
        style={{
          position: 'absolute',
          right: -60,
          top: 10,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 340,
          letterSpacing: '-0.06em',
          lineHeight: 1,
          color: 'rgba(255,255,255,0.035)',
        }}
      >
        {index}
      </div>
      <Rise>
        <div
          style={{ fontFamily: MONO, fontSize: 18, color: COLOR.accent, letterSpacing: '0.12em' }}
        >
          {String(index).padStart(2, '0')}
        </div>
      </Rise>
      <div
        style={{
          height: 3,
          width: 64 * line,
          background: COLOR.accent,
          borderRadius: 2,
          margin: '18px 0 26px',
        }}
      />
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.06,
          letterSpacing: '-0.035em',
          color: COLOR.text,
        }}
      >
        {title.split(' ').map((word, i) => (
          <Rise
            key={i}
            delay={3 + i * 2}
            distance={18}
            style={{ display: 'inline-block', marginRight: '0.26em' }}
          >
            {word}
          </Rise>
        ))}
      </div>
      {subtitle ? (
        <Rise delay={9}>
          <div
            style={{
              marginTop: 24,
              fontFamily: FONT,
              fontWeight: 500,
              fontSize: 28,
              lineHeight: 1.3,
              color: COLOR.muted,
              letterSpacing: '-0.01em',
            }}
          >
            {subtitle}
          </div>
        </Rise>
      ) : null}
    </div>
  )
}
