'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { formatDuration, SHOWCASE_PREVIEW_SECONDS, type ShowcaseReel } from '@/lib/showcase'

// The preview file is truncated, so loop at the end of what is actually buffered.
function loopPoint(video: HTMLVideoElement): number {
  const { buffered } = video
  const end = buffered.length > 0 ? buffered.end(buffered.length - 1) : SHOWCASE_PREVIEW_SECONDS
  return Math.max(Math.min(end - 0.15, SHOWCASE_PREVIEW_SECONDS), 0.5)
}

const LOAD_MARGIN = '200px'
const RATIO_STEPS = Array.from({ length: 11 }, (_, i) => i / 10)

type Props = {
  reel: ShowcaseReel
  index: number
  previewAllowed: boolean
  playing: boolean
  onRatio: (index: number, ratio: number) => void
}

function useObserved(
  ref: React.RefObject<HTMLElement | null>,
  options: IntersectionObserverInit,
  onChange: (entry: IntersectionObserverEntry) => void,
) {
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => entry && latest.current(entry), options)
    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, options.rootMargin])
}

const NEAR_OPTIONS = { rootMargin: LOAD_MARGIN }
const RATIO_OPTIONS = { threshold: RATIO_STEPS }

export function ShowcaseReelCard({ reel, index, previewAllowed, playing, onRatio }: Props) {
  const cardRef = useRef<HTMLAnchorElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [visibleTab, setVisibleTab] = useState(true)
  const [ready, setReady] = useState(false)
  const duration = formatDuration(reel.durationMs)

  useObserved(cardRef, NEAR_OPTIONS, (e) => e.isIntersecting && setNear(true))
  useObserved(cardRef, RATIO_OPTIONS, (e) =>
    onRatio(index, e.isIntersecting ? e.intersectionRatio : 0),
  )

  useEffect(() => {
    const sync = () => setVisibleTab(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  const loadVideo = previewAllowed && near
  const shouldPlay = loadVideo && playing && visibleTab

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!shouldPlay) {
      video.pause()
      return
    }
    video.play().catch(() => setReady(false))
  }, [shouldPlay, loadVideo])

  function onTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    const loopAt = loopPoint(video)
    if (video.currentTime >= loopAt) video.currentTime = 0
    const progress = Math.min(video.currentTime / loopAt, 1)
    if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`
  }

  return (
    <Link
      ref={cardRef}
      href={reel.href}
      aria-label={`Open reel: ${reel.title}`}
      className="group relative block aspect-[9/16] w-[210px] shrink-0 snap-center overflow-hidden rounded-[22px] bg-black shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:ring-white/25 sm:w-[236px]"
    >
      {reel.posterUrl && (
        <Image
          src={reel.posterUrl}
          alt=""
          fill
          sizes="(max-width: 640px) 210px, 236px"
          className="object-cover"
        />
      )}
      {loadVideo && (
        <video
          ref={videoRef}
          src={reel.previewUrl}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          onPlaying={() => setReady(true)}
          onTimeUpdate={onTimeUpdate}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/55 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
        <div ref={barRef} className="h-full origin-left scale-x-0 bg-accent" />
      </div>
      <div className="absolute inset-x-3.5 bottom-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] text-white/90">
          <span className="inline-flex min-h-6 items-center gap-1.5 rounded-full bg-black/40 px-2.5 backdrop-blur-md">
            <SourceDot source={reel.source} />
            {sourceMeta(reel.source).label}
          </span>
          {duration && <span className="tabular-nums text-white/70">{duration}</span>}
        </div>
        <p className="line-clamp-3 text-[14px] font-semibold leading-snug text-white [text-wrap:balance]">
          {reel.title}
        </p>
      </div>
    </Link>
  )
}
