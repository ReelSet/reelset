import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion'
import { COLOR, H, W } from './theme'

export function Background() {
  const frame = useCurrentFrame()
  const t = frame / 30
  const gx = Math.sin(t * 0.35) * 70
  const gy = Math.cos(t * 0.3) * 50
  const jitter = (Math.floor(frame / 2) * 37) % 256
  return (
    <AbsoluteFill style={{ background: COLOR.bg }}>
      <div
        style={{
          position: 'absolute',
          width: 760,
          height: 760,
          left: W - 440 + gx,
          top: -300 + gy,
          background: 'radial-gradient(closest-side, rgba(200,247,81,0.13), rgba(200,247,81,0))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 820,
          height: 820,
          left: -420 - gx,
          top: H - 560 - gy,
          background: 'radial-gradient(closest-side, rgba(120,140,255,0.10), rgba(120,140,255,0))',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: -256,
          backgroundImage: `url(${staticFile('grain.png')})`,
          backgroundSize: '256px 256px',
          opacity: 0.045,
          mixBlendMode: 'screen',
          transform: `translate(${jitter}px, ${(jitter * 3) % 256}px)`,
        }}
      />
    </AbsoluteFill>
  )
}

export function BottomFade() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 300,
        background: `linear-gradient(to bottom, rgba(9,9,11,0), ${COLOR.bg} 85%)`,
      }}
    />
  )
}
