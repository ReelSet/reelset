import { useCurrentFrame } from 'remotion'
import { SourceChip, Wordmark } from './Marks'
import { CHROME_BOTTOM, CHROME_SCALE, COLOR, SAFE, W } from './theme'
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
    <>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: CHROME_BOTTOM + 24,
          background:
            'linear-gradient(to bottom, rgba(9,9,11,0.7) 0%, rgba(9,9,11,0.55) 75%, rgba(9,9,11,0) 100%)',
        }}
      />
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: SAFE.top }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {scenes.map((scene, i) => {
            const fill = Math.min(1, Math.max(0, (frame - scene.from) / scene.frames))
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.18)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${fill * 100}%`,
                    height: '100%',
                    background: COLOR.text,
                    borderRadius: 3,
                  }}
                />
              </div>
            )
          })}
        </div>
        <div
          style={{
            marginTop: 18,
            width: W - SAFE.left - SAFE.right,
            boxSizing: 'border-box',
            paddingRight: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <SourceChip source={source} label={sourceLabel} size={CHROME_SCALE} />
          <Wordmark size={1.5} />
        </div>
      </div>
    </>
  )
}
