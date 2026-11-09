import { Card, Hero } from '../Media'
import { Rise } from '../fx'
import type { Source } from '../lib/types'
import { CONTENT_W, SAFE, SCENE_H, SCENE_TOP } from '../theme'

const CARD_H = 440

export function ImageScene({
  file,
  frames,
  source,
  sourceLabel,
  title,
}: {
  file?: string
  frames: number
  source: Source
  sourceLabel: string
  title: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: SCENE_TOP + (SCENE_H - CARD_H) / 2,
        width: CONTENT_W,
      }}
    >
      <Rise distance={28}>
        <Card width={CONTENT_W} height={CARD_H}>
          <Hero
            file={file}
            frames={frames + 20}
            source={source}
            sourceLabel={sourceLabel}
            title={title}
          />
        </Card>
      </Rise>
    </div>
  )
}
