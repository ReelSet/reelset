'use client'

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FeedItemDto } from '@/lib/api-types'
import { track } from '@/lib/client/track'
import {
  ArrowUpRightIcon,
  HeartIcon,
  LayersIcon,
  PlayIcon,
  ShareIcon,
  VolumeIcon,
} from '@/components/ui/icons'
import { SourceDot, sourceMeta } from '@/components/ui/sources'

export type ReelControls = { toggle: () => void }

type Props = {
  item: FeedItemDto
  index: number
  active: boolean
  inWindow: boolean
  preload: 'auto' | 'metadata'
  soundOn: boolean
  controls: MutableRefObject<ReelControls | null>
  onVisible: (index: number) => void
  onSound: (on: boolean) => void
  onToggleLike: (item: FeedItemDto) => void
  onOpenSources: (item: FeedItemDto) => void
}

const DOUBLE_TAP_MS = 280

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

export function ReelCard(props: Props) {
  const { item, index, active, inWindow, preload, soundOn, controls } = props
  const { onVisible, onSound, onToggleLike, onOpenSources } = props
  const sectionRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const maxRatio = useRef(0)
  const completeSent = useRef(false)
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const soundRef = useRef(soundOn)
  const [blocked, setBlocked] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [ready, setReady] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [heart, setHeart] = useState(0)

  soundRef.current = soundOn

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onVisible(index)
      },
      { threshold: 0.6 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [index, onVisible])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!active) {
      video.pause()
      video.currentTime = 0
      setExpanded(false)
      return
    }
    let cancelled = false
    maxRatio.current = 0
    completeSent.current = false
    setPaused(false)
    setFailed(false)
    video.muted = true
    video
      .play()
      .then(() => {
        if (cancelled) return
        setBlocked(false)
        if (!soundRef.current) return
        video.muted = false
        if (video.paused) {
          video.muted = true
          void video.play().catch(() => undefined)
          onSound(false)
        }
      })
      .catch(() => {
        if (!cancelled) setBlocked(true)
      })
    return () => {
      cancelled = true
      if (!completeSent.current && maxRatio.current > 0) {
        track({ name: 'reel_complete', itemId: item.id, meta: { watchRatio: maxRatio.current } })
      }
    }
  }, [active, item.id, onSound])

  useEffect(() => {
    const video = videoRef.current
    if (video && active && !video.paused) video.muted = !soundOn
  }, [soundOn, active])

  useEffect(() => {
    if (!active) return
    const handle: ReelControls = { toggle: togglePause }
    controls.current = handle
    return () => {
      if (controls.current === handle) controls.current = null
    }
  })

  function onTimeUpdate() {
    const video = videoRef.current
    if (!video || !video.duration) return
    const ratio = Math.min(1, video.currentTime / video.duration)
    if (ratio > maxRatio.current) maxRatio.current = Number(ratio.toFixed(3))
    if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`
    if (!completeSent.current && maxRatio.current >= 0.95) {
      completeSent.current = true
      track({ name: 'reel_complete', itemId: item.id, meta: { watchRatio: maxRatio.current } })
    }
  }

  function playFromGesture() {
    const video = videoRef.current
    if (!video) return
    video.muted = !soundRef.current
    video
      .play()
      .then(() => {
        setBlocked(false)
        setPaused(false)
      })
      .catch(() => setBlocked(true))
  }

  function togglePause() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      playFromGesture()
    } else {
      video.pause()
      setPaused(true)
    }
  }

  function like() {
    setHeart((n) => n + 1)
    if (!item.liked) onToggleLike(item)
  }

  function onTap() {
    if (blocked) {
      playFromGesture()
      return
    }
    const turnedOnSound = !soundRef.current
    if (turnedOnSound) {
      if (videoRef.current) videoRef.current.muted = false
      onSound(true)
    }
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      if (tapTimer.current) clearTimeout(tapTimer.current)
      like()
      return
    }
    lastTap.current = now
    if (turnedOnSound) return
    tapTimer.current = setTimeout(togglePause, DOUBLE_TAP_MS)
  }

  async function share() {
    const url = `${window.location.origin}/?reel=${item.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // share sheet dismissed or clipboard unavailable
    }
  }

  const sources = [...new Set(item.mentions.map((m) => m.source))].slice(0, 3)

  return (
    <section
      ref={sectionRef}
      data-index={index}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
    >
      {item.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {inWindow && (
        <video
          ref={videoRef}
          src={item.videoUrl}
          poster={item.posterUrl ?? undefined}
          preload={preload}
          playsInline
          muted
          loop
          onLoadedData={() => setReady(true)}
          onTimeUpdate={onTimeUpdate}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => {
            setBuffering(false)
            setPaused(false)
            setReady(true)
          }}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      <button
        type="button"
        aria-label="Tap to play or pause, double tap to like"
        onClick={onTap}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer"
      />

      {heart > 0 && (
        <div
          key={heart}
          className="animate-heart-pop pointer-events-none absolute inset-0 z-20 grid place-items-center"
        >
          <HeartIcon
            filled
            className="h-28 w-28 text-danger drop-shadow-[0_8px_24px_rgba(0,0,0,.45)]"
          />
        </div>
      )}

      {active && buffering && !blocked && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      {active && (blocked || paused) && !failed && (
        <div className="animate-fade-in pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="glass grid h-[72px] w-[72px] place-items-center rounded-full">
            <PlayIcon className="ml-1 h-8 w-8 text-white" />
          </div>
        </div>
      )}

      {failed && (
        <div className="glass absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-lg p-5 text-center text-sm">
          <p className="text-muted">This reel could not be played.</p>
          <button
            type="button"
            className="mt-3 rounded-full bg-fg px-5 py-2 font-medium text-bg transition active:scale-95"
            onClick={() => {
              setFailed(false)
              videoRef.current?.load()
              playFromGesture()
            }}
          >
            Try again
          </button>
        </div>
      )}

      {active && !soundOn && !blocked && !paused && (
        <button
          type="button"
          onClick={() => onSound(true)}
          className="glass animate-fade-in absolute left-1/2 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/90 transition active:scale-95 lg:top-5"
        >
          <VolumeIcon muted className="h-3.5 w-3.5" />
          Tap for sound
        </button>
      )}

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/55 to-transparent pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-4 pr-[4.5rem] pt-28 transition-[max-height] duration-300 ${expanded ? 'max-h-[75%]' : 'max-h-[60%]'}`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {sources.map((source) => (
            <span
              key={source}
              className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-white/90"
            >
              <SourceDot source={source} />
              {sourceMeta(source).label}
            </span>
          ))}
          {item.topics.slice(0, 2).map((t) => (
            <span key={t} className="px-1 text-[11px] text-white/55">
              #{t}
            </span>
          ))}
        </div>
        <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-white [text-wrap:balance]">
          {item.title}
        </h2>
        {item.tldr && (
          <div
            className={`mt-1.5 min-h-0 ${expanded ? 'pointer-events-auto overflow-y-auto no-scrollbar' : ''}`}
          >
            <p
              className={`text-[13.5px] leading-relaxed text-white/75 ${expanded ? '' : 'line-clamp-2'}`}
            >
              {item.tldr}
            </p>
          </div>
        )}
        <div className="pointer-events-auto mt-2.5 flex items-center gap-3 text-xs">
          {item.tldr && item.tldr.length > 90 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-white/60 transition hover:text-white"
            >
              {expanded ? 'Less' : 'More'}
            </button>
          )}
          <a
            href={item.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              track({ name: 'item_open', itemId: item.id, meta: { source: 'original' } })
            }
            className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full bg-white/10 px-2.5 py-1 text-white/85 transition hover:bg-white/20"
          >
            <span className="truncate">{host(item.canonicalUrl)}</span>
            <ArrowUpRightIcon className="h-3 w-3 shrink-0" />
          </a>
        </div>
      </div>

      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-2.5 z-30 flex flex-col items-center gap-4">
        <RailButton
          label={item.liked ? 'Unlike' : 'Like'}
          pressed={item.liked}
          text={String(item.likeCount)}
          onClick={() => onToggleLike(item)}
        >
          <HeartIcon
            filled={item.liked}
            className={`h-6 w-6 transition-all duration-300 ease-spring ${item.liked ? 'scale-110 text-danger' : ''}`}
          />
        </RailButton>
        <RailButton
          label="Sources"
          text={String(item.mentions.length)}
          onClick={() => onOpenSources(item)}
        >
          <LayersIcon className="h-6 w-6" />
        </RailButton>
        <RailButton label="Share" text={copied ? 'Copied' : 'Share'} onClick={() => void share()}>
          <ShareIcon className="h-6 w-6" />
        </RailButton>
        <RailButton
          label={soundOn ? 'Mute' : 'Unmute'}
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = soundOn
            onSound(!soundOn)
          }}
        >
          <VolumeIcon muted={!soundOn} className="h-6 w-6" />
        </RailButton>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/10">
        <div
          ref={barRef}
          className="h-full origin-left scale-x-0 bg-accent will-change-transform"
        />
      </div>
    </section>
  )
}

function RailButton({
  label,
  text,
  pressed,
  onClick,
  children,
}: {
  label: string
  text?: string
  pressed?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="group flex w-12 flex-col items-center gap-1 text-white"
    >
      <span className="glass grid h-11 w-11 place-items-center rounded-full transition duration-150 ease-out group-hover:bg-white/15 group-active:scale-90">
        {children}
      </span>
      {text && <span className="text-[11px] font-medium text-white/80 tabular-nums">{text}</span>}
    </button>
  )
}
