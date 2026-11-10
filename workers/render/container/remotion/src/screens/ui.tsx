import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion'
import { Drift, easeOut } from '../fx'
import { fitImage } from '../lib/images'
import { BG_OPACITY } from '../lib/broll'
import type { BrollClip, ItemFacts, ReelDemo, ReelImage, Source } from '../lib/types'
import { COLOR, CONTENT_TOP, FONT, H, SAFE, W } from '../theme'

export type ReelCtx = {
  title: string
  source: Source
  sourceLabel: string
  domain: string
  facts: ItemFacts
  images: ReelImage[]
  hook: string
  /** The script's short headline (hook card), when given. */
  headline?: string
  demo?: ReelDemo
  /** The plan plays the demo as its own shot (RepoDemo), so other screens leave it out. */
  demoInPlan?: boolean
}

export type ScreenProps = {
  frames: number
  ctx: ReelCtx
  props: Record<string, unknown>
  topPad: number
}

export const prop = <T,>(props: Record<string, unknown>, key: string, fallback: T): T => {
  const v = props[key]
  return v === undefined || v === null || v === '' ? fallback : (v as T)
}

export const TopPadContext = createContext(0)
export const BackdropContext = createContext<BrollClip | null>(null)
export const useBackdrop = () => useContext(BackdropContext)

/** Stock clip under a screen: muted, dimmed, graded and scrimmed so text always wins. */
export function Backdrop({ clip }: { clip: BrollClip }) {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ opacity: BG_OPACITY }}>
        <OffthreadVideo
          src={staticFile(clip.src)}
          startFrom={Math.round((clip.at ?? 0) * 30)}
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'saturate(0.8) contrast(1.06) brightness(0.9)',
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to bottom, rgba(9,9,11,0.72) 0%, rgba(9,9,11,0.5) 40%, rgba(9,9,11,0.5) 60%, rgba(9,9,11,0.78) 100%)',
        }}
      />
      <AbsoluteFill style={{ background: 'rgba(200,247,81,0.05)', mixBlendMode: 'soft-light' }} />
    </AbsoluteFill>
  )
}

export function Page({
  frames,
  tint = COLOR.accent,
  bg = COLOR.bg,
  topPad = 0,
  bleed = false,
  children,
  style,
}: {
  frames: number
  tint?: string
  bg?: string
  topPad?: number
  bleed?: boolean
  children?: ReactNode
  style?: CSSProperties
}) {
  const frame = useCurrentFrame()
  const gx = Math.sin(frame / 40) * 60
  const clip = useBackdrop()
  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: COLOR.text }}>
      <Drift frames={frames} to={1.045}>
        <AbsoluteFill>
          <div
            style={{
              position: 'absolute',
              width: 1200,
              height: 1200,
              left: W - 760 + gx,
              top: -420,
              background: `radial-gradient(closest-side, ${tint}3d, ${tint}00)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 1500,
              height: 1100,
              left: -210 - gx,
              top: 330,
              background: `radial-gradient(closest-side, ${tint}1c, ${tint}00)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: 1300,
              height: 1300,
              left: -640 - gx,
              top: H - 800,
              background:
                'radial-gradient(closest-side, rgba(120,140,255,0.14), rgba(120,140,255,0))',
            }}
          />
          {clip ? <Backdrop clip={clip} /> : null}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
              backgroundSize: '108px 108px',
            }}
          />
        </AbsoluteFill>
      </Drift>
      {bleed ? (
        children
      ) : (
        <div
          style={{
            position: 'absolute',
            left: SAFE.left,
            right: SAFE.right,
            top: CONTENT_TOP + topPad,
            bottom: 0,
            ...style,
          }}
        >
          <TopPadContext.Provider value={topPad}>{children}</TopPadContext.Provider>
        </div>
      )}
    </AbsoluteFill>
  )
}

/**
 * Keeps a block inside `maxHeight` px (the zone above the caption band): content that would run
 * taller is scaled down from its top-left corner instead of spilling under the captions.
 */
export function Fit({
  maxHeight,
  children,
  style,
  center = false,
}: {
  maxHeight: number
  children: ReactNode
  style?: CSSProperties
  /** Short content sits in the middle of the zone instead of its top. */
  center?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.scrollHeight
    setScale(h > maxHeight ? maxHeight / h : 1)
  }, [maxHeight, children])
  return (
    <div
      style={{
        height: maxHeight,
        overflow: 'hidden',
        ...(center ? { display: 'flex', flexDirection: 'column', justifyContent: 'center' } : {}),
        ...style,
      }}
    >
      <div ref={ref} style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        {children}
      </div>
    </div>
  )
}

export function useCount(frames: number, share = 0.5, delay = 4): number {
  const frame = useCurrentFrame()
  return easeOut(
    interpolate(frame, [delay, Math.max(delay + 1, frames * share)], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )
}

export const grouped = (n: number) => Math.round(n).toLocaleString('en-US')

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function Chip({
  children,
  color = COLOR.text,
  bg = 'rgba(255,255,255,0.08)',
  size = 34,
  style,
}: {
  children: ReactNode
  color?: string
  bg?: string
  size?: number
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: `${size * 0.3}px ${size * 0.7}px`,
        borderRadius: 999,
        background: bg,
        color,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/** A real source image: sharp when it fits, over a blurred darkened copy of itself that fills the frame. */
export function Photo({
  image,
  frames,
  x = 0,
  y = 0,
  w = W,
  h = H,
  zoomTo = 1.08,
  maxUp = 1.7,
  origin = '50% 50%',
  radius = 0,
  backdrop = true,
  pan = 0,
  keepInFrame = true,
  backdropOnly = false,
  contain = false,
}: {
  image: ReelImage
  frames: number
  x?: number
  y?: number
  w?: number
  h?: number
  zoomTo?: number
  maxUp?: number
  origin?: string
  radius?: number
  backdrop?: boolean
  pan?: number
  /** Contained images never zoom or pan past the frame edge, so no part of them is cut off. */
  keepInFrame?: boolean
  /** Only the blurred, darkened fill (a backdrop behind other content), no sharp copy. */
  backdropOnly?: boolean
  /** Always show the whole image (no cover crop). */
  contain?: boolean
}) {
  const frame = useCurrentFrame()
  const p = easeOut(Math.min(1, frame / Math.max(1, frames)))
  const iw = image.width ?? 1280
  const ih = image.height ?? 720
  const fitted = fitImage(iw, ih, w, h)
  // Text-bearing images (share cards, screenshots) are never cropped to fill.
  const cover =
    contain && fitted.mode === 'cover' ? { ...fitted, mode: 'contain' as const } : fitted
  let dw: number
  let dh: number
  let zoom = zoomTo
  let panLimit = Infinity
  if (cover.mode === 'cover') {
    dw = cover.width
    dh = cover.height
  } else {
    const scale = keepInFrame
      ? Math.min((w * 0.92) / iw, maxUp, h / ih)
      : Math.min(Math.min(w / iw, maxUp), h / ih)
    dw = iw * scale
    dh = ih * scale
    if (keepInFrame) {
      zoom = Math.max(1, Math.min(zoomTo, w / dw, h / dh))
      panLimit = Math.max(0, (w - dw * zoom) / 2)
    }
  }
  const src = staticFile(image.src)
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, overflow: 'hidden' }}>
      {backdrop ? (
        <Img
          src={src}
          style={{
            position: 'absolute',
            inset: -60,
            width: w + 120,
            height: h + 120,
            objectFit: 'cover',
            filter: 'blur(44px) brightness(0.45) saturate(1.25)',
          }}
        />
      ) : null}
      {backdropOnly ? null : (
        <div
          style={{
            position: 'absolute',
            left: (w - dw) / 2 + Math.max(-panLimit, Math.min(panLimit, pan * (p - 0.5))),
            top: (h - dh) / 2,
            width: dw,
            height: dh,
            transform: `scale(${1 + (zoom - 1) * p})`,
            transformOrigin: cover.mode !== 'cover' && keepInFrame ? '50% 50%' : origin,
            borderRadius: radius,
            overflow: 'hidden',
            boxShadow: cover.mode === 'cover' ? undefined : '0 30px 80px rgba(0,0,0,0.55)',
          }}
        >
          <Img src={src} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      )}
    </div>
  )
}

export function imageAt(ctx: ReelCtx, props: Record<string, unknown>): ReelImage | undefined {
  const idx = prop<number>(props, 'image', 0)
  return ctx.images[idx] ?? ctx.images[0]
}

/**
 * Highlights `phrase` inside `text` with a marker stroke that draws in under the words. The text
 * itself never changes colour, so no frame shows half a word hidden by the highlight.
 */
export function Sweep({
  text,
  phrase,
  frames,
  color = COLOR.accent,
  delay = 10,
}: {
  text: string
  phrase: string | null
  frames: number
  color?: string
  ink?: string
  delay?: number
}) {
  const frame = useCurrentFrame()
  const at = phrase ? text.toLowerCase().indexOf(phrase.toLowerCase()) : -1
  if (!phrase || at < 0) return <>{text}</>
  const p = easeOut(
    interpolate(frame, [delay, Math.max(delay + 1, frames * 0.45)], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  )
  return (
    <>
      {text.slice(0, at)}
      <span
        style={{
          color: COLOR.text,
          backgroundImage: `linear-gradient(${color}66, ${color}66)`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 88%',
          backgroundSize: `${p * 100}% 38%`,
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {text.slice(at, at + phrase.length)}
      </span>
      {text.slice(at + phrase.length)}
    </>
  )
}

export const ghLanguageColor: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Rust: '#dea584',
  Go: '#00add8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#9aa0a6',
  Ruby: '#701516',
  Swift: '#f05138',
  Kotlin: '#a97bff',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Zig: '#ec915c',
}
