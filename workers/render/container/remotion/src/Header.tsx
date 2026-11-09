import { useCurrentFrame } from 'remotion'
import { SourceChip, Wordmark } from './Marks'
import { COLOR, SAFE, W } from './theme'
import type { Source, TimedScene } from './lib/types'

/** Slim burned chrome below 12% of the frame: scene progress, source chip, watermark. */
export function Header({
  scenes,
  source,
  sourceLabel,
}: {
  scenes: TimedScene[]
  source: Source
  sourceLabel: string
}) {
  const frame = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: SAFE.top }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {scenes.map((scene, i) => {
          const fill = Math.min(1, Math.max(0, (frame - scene.from) / scene.frames))
          return (
            <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
              <div style={{ width: `${fill * 100}%`, height: '100%', background: COLOR.text, borderRadius: 3 }} />
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 18, width: W - SAFE.left - SAFE.right, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SourceChip source={source} label={sourceLabel} size={1.45} />
        <Wordmark size={1.5} />
      </div>
    </div>
  )
}
