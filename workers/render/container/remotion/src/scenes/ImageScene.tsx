import { Card } from '../Media'
import { Rise } from '../fx'
import { captionFor } from '../lib/images'
import type { ReelImage } from '../lib/types'
import { SourceImage } from '../SourceImage'
import { COLOR, CONTENT_W, MONO, SAFE, SCENE_H, SCENE_TOP } from '../theme'

export const IMAGE_CARD_H = 380
const CAPTION_H = 40

export function ImageScene({
  image,
  domain,
  frames,
}: {
  image: ReelImage
  domain: string
  frames: number
}) {
  const total = IMAGE_CARD_H + CAPTION_H
  return (
    <div
      style={{
        position: 'absolute',
        left: SAFE.left,
        top: SCENE_TOP + (SCENE_H - total) / 2,
        width: CONTENT_W,
      }}
    >
      <Rise distance={28}>
        <Card width={CONTENT_W} height={IMAGE_CARD_H}>
          <SourceImage image={image} w={CONTENT_W} h={IMAGE_CARD_H} frames={frames} />
        </Card>
      </Rise>
      <Rise delay={6} style={{ marginTop: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: 26,
            fontFamily: MONO,
            fontSize: 17,
            color: COLOR.muted,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 4, background: COLOR.accent }} />
          {captionFor(image, domain)}
        </div>
      </Rise>
    </div>
  )
}
