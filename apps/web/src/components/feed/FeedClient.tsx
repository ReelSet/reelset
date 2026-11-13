'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { track } from '@/lib/client/track'
import { DEFAULT_COUNT_RULES } from '@/lib/counts'
import { useReelViews } from './useReelViews'
import { reelHref, type FeedScope } from '@/lib/reel-url'
import { metaTitle } from '@/lib/seo/site'
import { ReelAbout } from './ReelAbout'
import { ReelCard, type ReelControls } from './ReelCard'
import {
  ChevronIcon,
  HashIcon,
  HomeIcon,
  SearchIcon,
  SparkleIcon,
  UserIcon,
} from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LogoMark, Wordmark } from '@/components/ui/Logo'
import { SocialLinks } from '@/components/ui/SocialLinks'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { ReelSkeleton } from './ReelSkeleton'
import { SourceDot, SOURCES } from '@/components/ui/sources'
import { SourcesSheet } from './SourcesSheet'
import { TopicPicker } from './TopicPicker'

const PENDING_LIKE_KEY = 'reelset.pendingLike'
const TOPICS_DISMISSED_KEY = 'reelset.topicsDismissed'

type Phase = 'loading' | 'ready' | 'error'

function readStorage(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(storage: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, value)
  } catch {
    // storage unavailable (private mode); the feature degrades silently
  }
}

type FeedClientProps = {
  /** Server-rendered first page; without it the feed loads from /api/feed on mount. */
  initial?: FeedResponse
  /** Details panel for the reel a /r/ page opened, shown beside it on wide screens. */
  about?: React.ReactNode
  aboutItemId?: string
  /** Topic slug when the feed is one topic's reels; every page then stays in that topic. */
  topic?: string | null
  /** Source (hn, github, ...) when the feed was opened from a source filter. */
  source?: string | null
}

export function FeedClient({
  initial,
  about,
  aboutItemId,
  topic = null,
  source = null,
}: FeedClientProps = {}) {
  const [items, setItems] = useState<FeedItemDto[]>(initial?.items ?? [])
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null)
  const [phase, setPhase] = useState<Phase>(initial ? 'ready' : 'loading')
  const [viewer, setViewer] = useState(
    initial?.viewer ?? { authenticated: false, needsTopics: false },
  )
  const [countRules, setCountRules] = useState(initial?.countRules ?? DEFAULT_COUNT_RULES)
  const [active, setActive] = useState(0)
  const [soundOn, setSoundOn] = useState(false)
  const [sourcesFor, setSourcesFor] = useState<FeedItemDto | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const loadingMore = useRef(false)
  const toast = useToast()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const controls = useRef<ReelControls | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patchItem = useCallback((id: string, patch: Partial<FeedItemDto>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const sendLike = useCallback(
    async (item: FeedItemDto, liked: boolean) => {
      patchItem(item.id, {
        liked,
        likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)),
      })
      track({ name: liked ? 'like' : 'unlike', itemId: item.id })
      try {
        const res = await fetch('/api/likes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, liked }),
        })
        if (res.status === 401) {
          const body = (await res.json()) as { loginUrl: string }
          if (liked) writeStorage(sessionStorage, PENDING_LIKE_KEY, item.id)
          window.location.assign(body.loginUrl)
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { liked: boolean; likeCount: number }
        patchItem(item.id, { liked: body.liked, likeCount: body.likeCount })
      } catch {
        patchItem(item.id, { liked: item.liked, likeCount: item.likeCount })
        toast.show(
          navigator.onLine
            ? 'Could not save your like. Try again.'
            : 'You are offline. Your like was not saved.',
          'error',
        )
      }
    },
    [patchItem, toast],
  )

  const toggleLike = useCallback(
    (item: FeedItemDto) => {
      const current = itemsRef.current.find((it) => it.id === item.id) ?? item
      void sendLike(current, !current.liked)
    },
    [sendLike],
  )

  const toggleSave = useCallback(
    async (item: FeedItemDto) => {
      const current = itemsRef.current.find((it) => it.id === item.id) ?? item
      const saved = !current.saved
      patchItem(item.id, { saved, saveCount: Math.max(0, current.saveCount + (saved ? 1 : -1)) })
      try {
        const res = await fetch('/api/saves', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, saved }),
        })
        if (res.status === 401) {
          const body = (await res.json()) as { loginUrl: string }
          window.location.assign(body.loginUrl)
          return
        }
        if (!res.ok) throw new Error(String(res.status))
        toast.show(saved ? 'Saved to your profile' : 'Removed from saved', 'ok')
      } catch {
        patchItem(item.id, { saved: current.saved, saveCount: current.saveCount })
        toast.show(
          navigator.onLine ? 'Could not save this reel. Try again.' : 'You are offline.',
          'error',
        )
      }
    },
    [patchItem, toast],
  )

  const applyFeed = useCallback(
    (feed: FeedResponse) => {
      setItems(feed.items)
      setCursor(feed.nextCursor)
      setViewer(feed.viewer)
      setCountRules(feed.countRules)
      setPickerOpen(
        feed.viewer.needsTopics && readStorage(localStorage, TOPICS_DISMISSED_KEY) === null,
      )
      setPhase('ready')
      track({ name: 'feed_view' })

      const pending = readStorage(sessionStorage, PENDING_LIKE_KEY)
      if (pending && feed.viewer.authenticated) {
        writeStorage(sessionStorage, PENDING_LIKE_KEY, null)
        const target = feed.items.find((it) => it.id === pending)
        if (target && !target.liked) void sendLike(target, true)
      }
    },
    [sendLike],
  )

  const loadInitial = useCallback(async () => {
    setPhase('loading')
    try {
      const res = await fetch(feedUrl({ topic, source }))
      if (!res.ok) throw new Error(String(res.status))
      applyFeed((await res.json()) as FeedResponse)
    } catch {
      setPhase('error')
    }
  }, [applyFeed, topic, source])

  const initialRef = useRef(initial)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    if (initialRef.current) applyFeed(initialRef.current)
    else void loadInitial()
  }, [applyFeed, loadInitial])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return
    loadingMore.current = true
    setMoreState('loading')
    try {
      const res = await fetch(feedUrl({ topic, source }, cursor))
      if (!res.ok) throw new Error(String(res.status))
      const feed = (await res.json()) as FeedResponse
      setItems((cur) => {
        const seen = new Set(cur.map((it) => it.id))
        return [...cur, ...feed.items.filter((it) => !seen.has(it.id))]
      })
      setCursor(feed.nextCursor)
      setMoreState('idle')
    } catch {
      setMoreState('failed')
    } finally {
      loadingMore.current = false
    }
  }, [cursor, topic, source])

  useEffect(() => {
    if (phase === 'ready' && moreState !== 'failed' && active >= items.length - 3) void loadMore()
  }, [active, items.length, phase, loadMore, moreState])

  useReelViews(phase === 'ready' ? items[active]?.id : undefined)

  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    const current = items[active]
    if (!current || startedFor.current === current.id) return
    startedFor.current = current.id
    track({ name: 'reel_start', itemId: current.id })
  }, [active, items])

  // Like Instagram: the address bar names the reel on screen. replaceState keeps Back meaning
  // "leave the feed"; the home page keeps `/` until the viewer first moves.
  const urlSynced = useRef(false)
  useEffect(() => {
    const current = items[active]
    if (phase !== 'ready' || !current) return
    const first = !urlSynced.current
    urlSynced.current = true
    if (first && window.location.pathname === '/') return
    const href = reelHref(current, { topic, source })
    if (window.location.pathname + window.location.search !== href) {
      window.history.replaceState(null, '', href)
    }
    document.title = `${metaTitle(current.title)} | Reelset`
  }, [active, items, phase, topic, source])

  const goTo = useCallback((index: number) => {
    const target = scrollerRef.current?.children[index]
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      if (sourcesFor || pickerOpen) return
      const current = itemsRef.current[active]
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          goTo(Math.min(active + 1, itemsRef.current.length))
          break
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          goTo(Math.max(active - 1, 0))
          break
        case ' ':
          if (el?.tagName === 'BUTTON' || el?.tagName === 'A') return
          e.preventDefault()
          controls.current?.toggle()
          break
        case 'm':
          setSoundOn((on) => !on)
          break
        case 'l':
          if (current) toggleLike(current)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, active, goTo, toggleLike, sourcesFor, pickerOpen])

  const [offline, setOffline] = useState(false)
  useEffect(() => {
    setOffline(!navigator.onLine)
    const sync = () => setOffline(!navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  const accountHref = viewer.authenticated ? '/profile' : '/login'
  const shell = (children: React.ReactNode, canNavigate = false) => (
    <div className="h-dvh w-full lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-10 lg:px-8">
      <aside className="hidden flex-col justify-between py-10 lg:flex">
        <div>
          <Wordmark className="text-lg" />
          <p className="mt-4 max-w-[14rem] text-sm leading-relaxed text-muted">
            What developers are building, in 60-second reels.
          </p>
          <nav className="mt-8 flex flex-col gap-1 text-sm">
            <SideLink href="/" active icon={<HomeIcon className="h-[18px] w-[18px]" />}>
              Feed
            </SideLink>
            <SideLink href="/t" icon={<HashIcon className="h-[18px] w-[18px]" />}>
              Topics
            </SideLink>
            <SideLink href="/ask" icon={<SparkleIcon className="h-[18px] w-[18px]" />}>
              Ask
            </SideLink>
            <SideLink href={accountHref} icon={<UserIcon className="h-[18px] w-[18px]" />}>
              {viewer.authenticated ? 'Profile' : 'Sign in'}
            </SideLink>
          </nav>
        </div>
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-2 text-xs text-faint">
            {Object.entries(SOURCES).map(([key, s]) => (
              <li key={key} className="flex items-center gap-2">
                <SourceDot source={key} />
                {s.label}
              </li>
            ))}
          </ul>
          <SocialLinks />
        </div>
      </aside>

      <div className="relative h-dvh w-full overflow-hidden bg-black lg:my-4 lg:h-[calc(100dvh-2rem)] lg:w-[calc((100dvh-2rem)*9/16)] lg:rounded-[28px] lg:border lg:border-line lg:shadow-[0_24px_80px_-20px_rgba(0,0,0,.8)]">
        {children}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-4 pb-6 pt-safe lg:hidden">
          <Wordmark className="text-[15px] text-white" />
          <div className="pointer-events-auto flex items-center gap-2">
            <a
              href="/t"
              aria-label="Topics"
              className="glass grid h-9 w-9 place-items-center rounded-full transition active:scale-90"
            >
              <HashIcon className="h-[18px] w-[18px]" />
            </a>
            <a
              href="/ask"
              aria-label="Ask"
              className="glass grid h-9 w-9 place-items-center rounded-full transition active:scale-90"
            >
              <SearchIcon className="h-[18px] w-[18px]" />
            </a>
            <a
              href={accountHref}
              aria-label={viewer.authenticated ? 'Profile' : 'Sign in'}
              className="glass grid h-9 w-9 place-items-center rounded-full transition active:scale-90"
            >
              <UserIcon className="h-[18px] w-[18px]" />
            </a>
          </div>
        </div>
        {sourcesFor && <SourcesSheet item={sourcesFor} onClose={() => setSourcesFor(null)} />}
        {pickerOpen && (
          <TopicPicker
            onDone={() => {
              writeStorage(localStorage, TOPICS_DISMISSED_KEY, '1')
              setPickerOpen(false)
            }}
          />
        )}
      </div>

      <aside className="hidden flex-col items-start justify-end gap-6 py-10 lg:flex">
        {items[active] && (
          <div className="no-scrollbar max-h-[calc(100dvh-20rem)] w-80 overflow-y-auto">
            {about && items[active].id === aboutItemId ? about : <ReelAbout item={items[active]} />}
          </div>
        )}
        {canNavigate && (
          <div className="flex flex-col gap-2">
            <NavButton
              label="Previous reel"
              disabled={active === 0}
              onClick={() => goTo(active - 1)}
            >
              <ChevronIcon dir="up" className="h-5 w-5" />
            </NavButton>
            <NavButton label="Next reel" onClick={() => goTo(active + 1)}>
              <ChevronIcon className="h-5 w-5" />
            </NavButton>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-faint">
          <Kbd>↑ ↓</Kbd>
          <dd>Browse</dd>
          <Kbd>Space</Kbd>
          <dd>Play / pause</dd>
          <Kbd>M</Kbd>
          <dd>Sound</dd>
          <Kbd>L</Kbd>
          <dd>Like</dd>
        </dl>
      </aside>
    </div>
  )

  if (phase === 'loading') {
    return shell(<ReelSkeleton />)
  }

  if (phase === 'error') {
    return shell(
      <div className="absolute inset-0 grid place-items-center bg-surface">
        <ErrorState
          title={offline ? 'You are offline' : 'Could not load the feed'}
          body={
            offline
              ? 'Reconnect to the internet, then try again.'
              : 'Check your connection and try again.'
          }
          onRetry={() => void loadInitial()}
          retryLabel="Retry"
        />
      </div>,
    )
  }

  if (items.length === 0) {
    return shell(
      <div className="absolute inset-0 grid place-items-center bg-surface">
        <EmptyState
          icon={<LogoMark className="h-10 w-10" />}
          title="No reels yet"
          body="New stories are on the way. Check back soon, or ask a question in the meantime."
          action={
            <a
              href="/ask"
              className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
            >
              Try Ask
            </a>
          }
        />
      </div>,
    )
  }

  return shell(
    <div
      ref={scrollerRef}
      className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain scroll-smooth"
    >
      {items.map((item, index) => (
        <ReelCard
          key={item.id}
          item={item}
          countRules={countRules}
          index={index}
          active={index === active}
          inWindow={Math.abs(index - active) <= 2}
          preload={index === active || index === active + 1 ? 'auto' : 'metadata'}
          soundOn={soundOn}
          controls={controls}
          onVisible={setActive}
          onSound={setSoundOn}
          onToggleLike={toggleLike}
          onToggleSave={toggleSave}
          onOpenSources={setSourcesFor}
        />
      ))}
      {cursor && moreState === 'failed' && (
        <section className="grid h-full snap-start place-items-center bg-surface px-8 text-center">
          <ErrorState
            title="Could not load more reels"
            body="Check your connection and try again."
            onRetry={() => void loadMore()}
            retryLabel="Retry"
          />
        </section>
      )}
      {cursor && moreState === 'loading' && (
        <section className="grid h-full snap-start place-items-center bg-surface text-muted">
          <Spinner className="h-7 w-7" />
        </section>
      )}
      {!cursor && (
        <section className="grid h-full snap-start place-items-center bg-surface px-8 text-center">
          <div className="animate-fade-up">
            <LogoMark className="mx-auto h-10 w-10" />
            <p className="mt-4 text-lg font-semibold tracking-tight">You are all caught up</p>
            <p className="mt-1 text-sm text-muted">Fresh reels land every hour.</p>
            <div className="mt-5 flex justify-center gap-2">
              <a
                href="/t"
                className="inline-flex rounded-full border border-line px-5 py-2.5 text-sm font-medium text-fg transition active:scale-95"
              >
                Browse topics
              </a>
              <a
                href="/ask"
                className="inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95"
              >
                Ask the feed
              </a>
            </div>
          </div>
        </section>
      )}
    </div>,
    true,
  )
}

function feedUrl(scope: FeedScope, cursor?: string | null): string {
  const query = new URLSearchParams()
  if (cursor) query.set('cursor', cursor)
  if (scope.topic) query.set('topic', scope.topic)
  if (scope.source) query.set('source', scope.source)
  const qs = query.toString()
  return qs ? `/api/feed?${qs}` : '/api/feed'
}

function SideLink({
  href,
  icon,
  active,
  children,
}: {
  href: string
  icon: React.ReactNode
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex w-40 items-center gap-3 rounded-md px-3 py-2 transition ${
        active ? 'bg-raised text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg'
      }`}
    >
      {icon}
      {children}
    </a>
  )
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-muted transition hover:bg-raised hover:text-fg active:scale-90 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <dt>
      <kbd className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
        {children}
      </kbd>
    </dt>
  )
}
