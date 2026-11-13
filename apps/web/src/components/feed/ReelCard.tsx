'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import type { FeedItemDto } from '@/lib/api-types'
import { track } from '@/lib/client/track'
import { formatCount, visibleCount, type CountRules } from '@/lib/counts'
import {
  ArrowUpRightIcon,
  BookmarkIcon,
  EyeIcon,
  HeartIcon,
  LayersIcon,
  PlayIcon,
  ShareIcon,
  VolumeIcon,
} from '@/components/ui/icons'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { SourceDot, sourceMeta } from '@/components/ui/sources'
import { reelPath } from '@/lib/reel-url'

export type ReelControls = { toggle: () => void }

type Props = {
  item: FeedItemDto
  countRules: CountRules
  index: number
  active: boolean
  inWindow: boolean
  preload: 'auto' | 'metadata'
  soundOn: boolean
  controls: MutableRefObject<ReelControls | null>
  onVisible: (index: number) => void
  onSound: (on: boolean) => void
  onToggleLike: (item: FeedItemDto) => void
  onToggleSave: (item: FeedItemDto) => void
  onOpenSources: (item: FeedItemDto) => void
}

const DOUBLE_TAP_MS = 280
const HOLD_MS = 300

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

export function ReelCard(props: Props) {
  const { item, countRules, index, active, inWindow, preload, soundOn, controls } = props
  const { onVisible, onSound, onToggleLike, onToggleSave, onOpenSources } = props
  const formatted = (n: number, rule: CountRules['views']) => {
    const shown = visibleCount(n, rule)
    return shown === null ? null : formatCount(shown)
  }
  const views = formatted(item.viewCount, countRules.views)
  const likes = formatted(item.likeCount, countRules.likes)
  const saves = formatted(item.saveCount, countRules.saves)
  const sectionRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const maxRatio = useRef(0)
  const completeSent = useRef(false)
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const [soundFlash, setSoundFlash] = useState<{ on: boolean; key: number } | null>(null)
  const soundRef = useRef(soundOn)
  const [blocked, setBlocked] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [failed, setFailed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [ready, setReady] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()
  const detailsId = useId()
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
      if (tapTimer.current) clearTimeout(tapTimer.current)
      if (holdTimer.current) clearTimeout(holdTimer.current)
      held.current = false
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

  function setSound(on: boolean) {
    if (videoRef.current) videoRef.current.muted = !on
    onSound(on)
    setSoundFlash({ on, key: Date.now() })
  }

  function onTap() {
    if (held.current) {
      held.current = false
      return
    }
    if (blocked || paused) {
      playFromGesture()
      return
    }
    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      if (tapTimer.current) clearTimeout(tapTimer.current)
      like()
      return
    }
    lastTap.current = now
    // Browsers only allow unmuting inside the tap itself; muting can wait to rule out a double tap.
    if (!soundRef.current) {
      setSound(true)
      return
    }
    tapTimer.current = setTimeout(() => setSound(false), DOUBLE_TAP_MS)
  }

  function onPressStart() {
    held.current = false
    if (blocked || paused) return
    holdTimer.current = setTimeout(() => {
      held.current = true
      videoRef.current?.pause()
    }, HOLD_MS)
  }

  function onPressEnd() {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    if (held.current) void videoRef.current?.play().catch(() => undefined)
  }

  async function share() {
    const url = `${window.location.origin}${reelPath(item)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast.show('Link copied', 'ok')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      toast.show('Could not share this reel. Copy the link from the address bar.', 'error')
    }
  }

  const sources = [...new Set(item.mentions.map((m) => m.source))]
  const hasMore = Boolean(item.tldr) || item.title.length > 80

  return (
    <section
      ref={sectionRef}
      data-index={index}
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black [container-type:size]"
    >
      {item.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover cropped:object-contain"
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
          onError={() => {
            setFailed(true)
            setBuffering(false)
          }}
          onCanPlay={() => setBuffering(false)}
          onStalled={() => setBuffering(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity cropped:object-contain duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      <button
        type="button"
        aria-label="Tap for sound on or off, double tap to like, hold to pause"
        onClick={onTap}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onPointerCancel={onPressEnd}
        onPointerLeave={onPressEnd}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer select-none [-webkit-touch-callout:none]"
      />

      {soundFlash && (
        <div
          key={soundFlash.key}
          onAnimationEnd={() => setSoundFlash(null)}
          className="animate-sound-flash pointer-events-none absolute inset-0 z-20 grid place-items-center"
        >
          <div className="grid h-16 w-16 place-items-center rounded-full bg-black/60 text-white">
            <VolumeIcon muted={!soundFlash.on} className="h-7 w-7" />
          </div>
        </div>
      )}

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

      {active && (buffering || !ready) && !blocked && !failed && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center text-white">
          <Spinner className="h-9 w-9" />
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
          <p className="text-muted">
            {typeof navigator !== 'undefined' && !navigator.onLine
              ? 'You are offline. Reconnect to play this reel.'
              : 'This reel could not be played.'}
          </p>
          <button
            type="button"
            className="mt-3 rounded-full bg-fg px-5 py-2 font-medium text-bg transition active:scale-95"
            onClick={() => {
              setFailed(false)
              setReady(false)
              videoRef.current?.load()
              playFromGesture()
            }}
          >
            Try again
          </button>
        </div>
      )}

      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => setExpanded(false)}
        className={`absolute inset-0 z-[15] bg-gradient-to-t from-black/80 via-black/60 to-black/50 transition-opacity duration-300 ease-out ${expanded ? 'cursor-pointer opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-3.5 pr-[16%] pt-10 short:pb-[max(0.5rem,env(safe-area-inset-bottom))] short:pt-4">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"
        />
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent transition-opacity duration-300 ${expanded ? 'opacity-100' : 'opacity-0'}`}
        />
        <div className="relative flex min-h-0 flex-col" onClick={(e) => e.stopPropagation()}>
          <p className="pointer-events-auto mb-1 flex w-fit max-w-full items-center gap-1.5 text-[13px] text-white/70">
            <SourceDot source={sources[0] ?? 'news'} />
            <span className="shrink-0 font-medium text-white/85">
              {sourceMeta(sources[0] ?? 'news').label}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{host(item.canonicalUrl)}</span>
          </p>
          <h2 className="pointer-events-auto text-[15px] font-semibold leading-snug text-white [overflow-wrap:anywhere]">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => hasMore && setExpanded((v) => !v)}
              className={`relative block w-full text-left ${hasMore ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {expanded ? item.title : <ClampedTitle title={item.title} more={hasMore} lines={2} />}
            </button>
          </h2>
          <div
            id={detailsId}
            inert={!expanded}
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
          >
            <div className="pointer-events-auto min-h-0 overflow-hidden">
              <div className="no-scrollbar max-h-[calc(45cqh-5rem)] overflow-y-auto overscroll-contain pt-1.5">
                {item.tldr && (
                  <p
                    onClick={() => setExpanded(false)}
                    className="cursor-pointer text-[14px] leading-snug text-white/80"
                  >
                    {item.tldr}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3 text-[13px]">
                  <a
                    href={item.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      track({ name: 'item_open', itemId: item.id, meta: { source: 'original' } })
                    }
                    className="inline-flex min-w-0 items-center gap-1 text-white/90 underline decoration-white/30 underline-offset-2 transition hover:decoration-white/80"
                  >
                    <span className="truncate">{host(item.canonicalUrl)}</span>
                    <ArrowUpRightIcon className="h-3 w-3 shrink-0" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="text-white/60 transition hover:text-white"
                  >
                    less
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-0 z-30 flex w-[14%] flex-col items-center gap-2 short:bottom-[max(0.75rem,env(safe-area-inset-bottom))] short:gap-0.5 cropped:bottom-[max(0.5rem,env(safe-area-inset-bottom))] cropped:gap-0 cropped:[&>button]:min-h-10">
        {views !== null && (
          <div
            aria-label={`${views} views`}
            className="flex min-h-11 w-full flex-col items-center justify-center gap-0.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
          >
            <EyeIcon className="h-[26px] w-[26px]" />
            <span className="text-[12px] font-semibold leading-none tabular-nums">{views}</span>
          </div>
        )}
        <RailButton
          label={item.liked ? 'Unlike' : 'Like'}
          pressed={item.liked}
          text={likes ?? undefined}
          onClick={() => onToggleLike(item)}
        >
          <HeartIcon
            filled={item.liked}
            className={`h-[30px] w-[30px] transition-all duration-300 ease-spring ${item.liked ? 'scale-110 text-danger' : ''}`}
          />
        </RailButton>
        <RailButton
          label="Sources"
          text={String(item.mentions.length)}
          onClick={() => onOpenSources(item)}
        >
          <LayersIcon className="h-[28px] w-[28px]" />
        </RailButton>
        <RailButton
          label={item.saved ? 'Unsave' : 'Save'}
          pressed={item.saved}
          text={saves ?? undefined}
          onClick={() => onToggleSave(item)}
        >
          <BookmarkIcon
            filled={item.saved}
            className="h-[28px] w-[28px] transition-all duration-300 ease-spring"
          />
        </RailButton>
        <RailButton label={copied ? 'Copied' : 'Share'} onClick={() => void share()}>
          <ShareIcon className="h-[28px] w-[28px]" />
        </RailButton>
        <RailButton
          label={soundOn ? 'Mute' : 'Unmute'}
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = soundOn
            onSound(!soundOn)
          }}
        >
          <VolumeIcon muted={!soundOn} className="h-[26px] w-[26px]" />
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

function ClampedTitle({ title, more, lines }: { title: string; more: boolean; lines: number }) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<{ text: string; cut: boolean } | null>(null)

  useLayoutEffect(() => {
    const box = measureRef.current
    if (!box) return
    const textNode = document.createTextNode('')
    const moreNode = document.createElement('span')
    moreNode.textContent = 'more'
    box.replaceChildren(textNode, moreNode)
    const compute = () => {
      const lineHeight = parseFloat(getComputedStyle(box).lineHeight) || 20
      const fits = (text: string, ellipsis: boolean) => {
        textNode.data = ellipsis ? `${text}\u2026 ` : `${text} `
        moreNode.hidden = !more
        return box.scrollHeight <= lineHeight * lines + 1
      }
      if (fits(title, false)) return setShown({ text: title, cut: false })
      let lo = 0
      let hi = title.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (fits(title.slice(0, mid).trimEnd(), true)) lo = mid
        else hi = mid - 1
      }
      setShown({ text: title.slice(0, lo).trimEnd(), cut: true })
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(box)
    return () => observer.disconnect()
  }, [title, more, lines])

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-0 top-0 -z-10 block text-[15px] font-semibold leading-snug [&>span]:text-[13px] [&>span]:font-normal"
      />
      {shown ? (
        <>
          <span className="sr-only">{title}</span>
          <span aria-hidden>
            {shown.text}
            {shown.cut ? '\u2026 ' : ' '}
            {more && <span className="text-[13px] font-normal text-white/60">more</span>}
          </span>
        </>
      ) : (
        <span className="line-clamp-2">{title}</span>
      )}
    </>
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
      className="group flex min-h-11 w-full min-w-11 flex-col items-center justify-center gap-0.5 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
    >
      <span className="transition duration-150 ease-out group-active:scale-90">{children}</span>
      {text && <span className="text-[12px] font-semibold leading-none tabular-nums">{text}</span>}
    </button>
  )
}
