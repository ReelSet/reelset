import { Art } from '../art'
import type { ArtKind } from '../lib/art'
import { Card } from '../Media'
import { Rise } from '../fx'
import { CONTENT_W, SAFE, SCENE_H, SCENE_TOP } from '../theme'

const CARD_H = 440

export function ArtScene({
  kind,
  seed,
  tool,
  frames,
}: {
  kind: ArtKind
  seed: number
  tool: string
  frames: number
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
          <Art kind={kind} w={CONTENT_W} h={CARD_H} frames={frames} seed={seed} tool={tool} />
        </Card>
      </Rise>
    </div>
  )
}
