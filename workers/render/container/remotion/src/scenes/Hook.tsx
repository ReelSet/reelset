import { Hero, Card } from '../Media'
import { Rise, useSpring } from '../fx'
import { fitText } from '../lib/text'
import type { Source, Word } from '../lib/types'
import { COLOR, CONTENT_W, FONT, SAFE, SCENE_H, SCENE_TOP } from '../theme'
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

const CARD_H = 392
const TEXT_GAP = 36

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
  hero,
  frames,
  source,
  sourceLabel,
  title,
}: {
  text: string
  words: Word[]
  hero?: string
  frames: number
  source: Source
  sourceLabel: string
  title: string
}) {
  const size = fitText(
    text,
    { width: CONTENT_W, height: 960 - (SCENE_TOP + CARD_H + TEXT_GAP) },
    {
      min: 38,
      max: 76,
      charWidth: 0.55,
      lineHeight: 1.08,
    },
  )
  return (
    <div style={{ position: 'absolute', left: SAFE.left, top: SCENE_TOP, width: CONTENT_W }}>
      <Rise distance={26}>
        <Card width={CONTENT_W} height={CARD_H}>
          <Hero
            file={hero}
            frames={frames + 60}
            source={source}
            sourceLabel={sourceLabel}
            title={title}
          />
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
