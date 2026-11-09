import { Art } from '../art'
import type { ArtKind } from '../lib/art'
import { Card } from '../Media'
import { Rise, useSpring } from '../fx'
import { fitText } from '../lib/text'
import type { ReelImage, Word } from '../lib/types'
import { PlayBadge, SourceImage } from '../SourceImage'
import { COLOR, CONTENT_W, FONT, SAFE, SCENE_BOTTOM, SCENE_TOP } from '../theme'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

const ART_H = 220
const HERO_H = 270
const TEXT_GAP = 28

function KineticWord({ word, size }: { word: Word; size: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const start = Math.round(word.start * fps)
  const s = useSpring(start, 15, 0.6)
  const live = frame >= start && frame < Math.round(word.end * fps) + 3
  return (
    <span
      style={{
        display: 'inline-block',
        marginRight: '0.24em',
        opacity: Math.min(1, s * 1.6),
        transform: `translateY(${interpolate(s, [0, 1], [30, 0])}px)`,
        color: live ? COLOR.accent : COLOR.text,
      }}
    >
      {word.text}
    </span>
  )
}

export function HookScene({
  text,
  words,
  kind,
  seed,
  tool,
  frames,
  hero,
  play,
}: {
  text: string
  words: Word[]
  kind: ArtKind
  seed: number
  tool: string
  frames: number
  hero?: ReelImage | null
  play?: boolean
}) {
  const CARD_H = hero ? HERO_H : ART_H
  const size = fitText(
    text,
    { width: CONTENT_W, height: SCENE_BOTTOM - (SCENE_TOP + CARD_H + TEXT_GAP) },
    {
      min: 34,
      max: 76,
      charWidth: 0.55,
      lineHeight: 1.08,
    },
  )
  return (
    <div style={{ position: 'absolute', left: SAFE.left, top: SCENE_TOP, width: CONTENT_W }}>
      <Rise distance={26}>
        <Card width={CONTENT_W} height={CARD_H}>
          {hero ? (
            <>
              <SourceImage image={hero} w={CONTENT_W} h={CARD_H} frames={frames} />
              {play ? <PlayBadge /> : null}
            </>
          ) : (
            <Art kind={kind} w={CONTENT_W} h={CARD_H} frames={frames} seed={seed} tool={tool} />
          )}
        </Card>
      </Rise>
      <div
        style={{
          marginTop: TEXT_GAP,
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: size,
          lineHeight: 1.08,
          letterSpacing: '-0.035em',
        }}
      >
        {words.map((w, i) => (
          <KineticWord key={i} word={w} size={size} />
        ))}
      </div>
    </div>
  )
}
