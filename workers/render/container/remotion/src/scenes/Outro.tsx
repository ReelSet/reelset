import { Img, staticFile } from 'remotion'
import { Art } from '../art'
import { Glyph } from '../Marks'
import type { ArtKind } from '../lib/art'
import { Card } from '../Media'
import { Rise } from '../fx'
import { fitText } from '../lib/text'
import type { Source } from '../lib/types'
import { COLOR, CONTENT_W, FONT, MONO, SAFE, SCENE_TOP } from '../theme'

export function OutroScene({
  title,
  domain,
  sourceLabel,
  source,
  kind,
  seed,
  tool,
  cover,
  frames,
}: {
  title: string
  domain: string
  sourceLabel: string
  source: Source
  kind: ArtKind
  seed: number
  tool: string
  cover?: string
  frames: number
}) {
  const size = fitText(
    title,
    { width: CONTENT_W, height: 140 },
    { min: 30, max: 46, lineHeight: 1.12 },
  )
  return (
    <div style={{ position: 'absolute', left: SAFE.left, top: SCENE_TOP, width: CONTENT_W }}>
      <Rise distance={26}>
        <Card width={CONTENT_W} height={300}>
          <Art kind={kind} w={CONTENT_W} h={300} frames={frames} seed={seed} tool={tool} />
        </Card>
      </Rise>
      <Rise delay={5} style={{ marginTop: 30 }}>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 1.12,
            letterSpacing: '-0.03em',
            color: COLOR.text,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
      </Rise>
      <Rise delay={9} style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 104,
              height: 58,
              borderRadius: 10,
              overflow: 'hidden',
              flexShrink: 0,
              background: COLOR.surface2,
              border: `1px solid ${COLOR.line}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {cover ? (
              <Img
                src={staticFile(cover)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Glyph source={source} size={30} />
            )}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 17, lineHeight: 1.35, color: COLOR.muted }}>
            via {sourceLabel}
            <br />
            {domain}
          </div>
        </div>
      </Rise>
      <Rise delay={14} style={{ marginTop: 34 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            height: 62,
            padding: '0 30px',
            borderRadius: 31,
            background: COLOR.accent,
            color: COLOR.accentInk,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 27,
            letterSpacing: '-0.02em',
          }}
        >
          reelset.app
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              stroke={COLOR.accentInk}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Rise>
    </div>
  )
}
