import { Art } from '../art'
import { Rise, useSpring } from '../fx'
import type { ArtKind } from '../lib/art'
import { fitText } from '../lib/text'
import { Card } from '../Media'
import { COLOR, CONTENT_W, FONT, SAFE, SCENE_H, SCENE_TOP } from '../theme'

const ART_H = 150

export function TitleScene({
  title,
  subtitle,
  kind,
  seed,
  tool,
  frames,
}: {
  title: string
  subtitle?: string
  kind: ArtKind
  seed: number
  tool: string
  frames: number
}) {
  const size = fitText(
    title,
    { width: CONTENT_W, height: subtitle ? 150 : 200 },
    { min: 38, max: 68, lineHeight: 1.06 },
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
      <Rise distance={26}>
        <Card width={CONTENT_W} height={ART_H}>
          <Art kind={kind} w={CONTENT_W} h={ART_H} frames={frames} seed={seed} tool={tool} />
        </Card>
      </Rise>
      <div
        style={{
          height: 3,
          width: 64 * line,
          background: COLOR.accent,
          borderRadius: 2,
          margin: '24px 0 18px',
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
              marginTop: 18,
              fontFamily: FONT,
              fontWeight: 500,
              fontSize: 26,
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
