import { Img, staticFile } from 'remotion'
import { useProgress } from './fx'
import { fitImage } from './lib/images'
import type { ReelImage } from './lib/types'
import { COLOR } from './theme'

const FALLBACK_W = 1280
const FALLBACK_H = 720

/** A real source image inside a w x h frame: slow Ken Burns, soft gradient, grain, blurred backdrop when it must stay small. */
export function SourceImage({
  image,
  w,
  h,
  frames,
}: {
  image: ReelImage
  w: number
  h: number
  frames: number
}) {
  const p = useProgress(frames)
  const iw = image.width ?? FALLBACK_W
  const ih = image.height ?? FALLBACK_H
  const fit = fitImage(iw, ih, w, h)
  const cover = fit.mode === 'cover'
  const scale = 1 + (cover ? 0.07 : 0.025) * p
  const panX = (p - 0.5) * (cover ? -14 : -6)
  const panY = (p - 0.5) * (cover ? -8 : 0)
  const src = staticFile(image.src)
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLOR.surface2 }}>
      {!cover ? (
        <Img
          src={src}
          style={{
            position: 'absolute',
            inset: -30,
            width: w + 60,
            height: h + 60,
            objectFit: 'cover',
            filter: 'blur(26px) brightness(0.5) saturate(1.2)',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: (w - fit.width) / 2,
          top: (h - fit.height) / 2,
          width: fit.width,
          height: fit.height,
          transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
          borderRadius: cover ? 0 : 14,
          overflow: 'hidden',
          boxShadow: cover ? undefined : '0 18px 50px rgba(0,0,0,0.55)',
        }}
      >
        <Img src={src} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(to top, rgba(9,9,11,0.5) 0%, rgba(9,9,11,0) 42%, rgba(9,9,11,0.12) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${staticFile('grain.png')})`,
          backgroundSize: '256px 256px',
          opacity: 0.07,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  )
}

export function PlayBadge({ size = 76 }: { size?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: size / 2,
        background: 'rgba(9,9,11,0.62)',
        border: '1.5px solid rgba(255,255,255,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24">
        <path d="M7 4.5v15l13-7.5z" fill="#f4f4f5" />
      </svg>
    </div>
  )
}
