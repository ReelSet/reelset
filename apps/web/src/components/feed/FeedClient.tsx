'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedItemDto, FeedResponse } from '@/lib/api-types'
import { track } from '@/lib/client/track'
import { DEFAULT_COUNT_RULES } from '@/lib/counts'
import { useReelViews } from './useReelViews'
import {
  FEEDBACK_KEY,
  emptyFeedback,
  hideItem,
  isSuppressed,
  muteTopics,
  parseFeedback,
} from '@/lib/feed-feedback'
import { createIntentQueue } from '@/lib/intent-queue'
import { MAX_FOLLOWED_TOPICS } from '@/lib/topics'
import { reelHref, scopeQuery, type FeedScope } from '@/lib/reel-url'
import { metaTitle } from '@/lib/seo/site'
import { ReelAbout } from './ReelAbout'
import { ReelCard, type ReelControls } from './ReelCard'
import { ChevronIcon } from '@/components/ui/icons'
import { BottomTabs } from '@/components/ui/AppNav'
import { SideRail } from '@/components/ui/SideRail'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LogoMark } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { ReelSkeleton } from './ReelSkeleton'
import { DetailsSheet } from './DetailsSheet'
import { FeedbackMenu } from './FeedbackMenu'
import { SourcesSheet } from './SourcesSheet'
import { SwipeHint } from './SwipeHint'
import { TopicPicker } from './TopicPicker'

const PENDING_LIKE_KEY = 'reelset.pendingLike'
const TOPICS_DISMISSED_KEY = 'reelset.topicsDismissed'
const SWIPE_HINT_KEY = 'reelset.swipeHintSeen'

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

const FADE = 'linear-gradient(to bottom, black calc(100% - 28px), transparent)'

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
  const [scope, setScope] = useState<FeedScope>({ topic, source })
  const [followed, setFollowed] = useState<string[]>([])
  const [menuFor, setMenuFor] = useState<FeedItemDto | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [mobile, setMobile] = useState(false)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const feedback = useRef(emptyFeedback())
  const requestId = useRef(0)
  const urlSynced = useRef(false)
  const loadingMore = useRef(false)
  const toast = useToast()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const controls = useRef<ReelControls | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  const patchItem = useCallback((id: string, patch: Partial<FeedItemDto>) => {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const setFlag = useCallback((id: string, field: 'liked' | 'saved', on: boolean) => {
    const count = field === 'liked' ? 'likeCount' : 'saveCount'
    setItems((cur) =>
      cur.map((it) =>
        it.id === id && it[field] !== on
          ? { ...it, [field]: on, [count]: Math.max(0, it[count] + (on ? 1 : -1)) }
          : it,
      ),
    )
  }, [])

  const redirectToLogin = useCallback(async (res: Response) => {
    const body = (await res.json()) as { loginUrl: string }
    window.location.assign(body.loginUrl)
  }, [])

  const toastRef = useRef(toast)
  toastRef.current = toast

  const [likeQueue] = useState(() =>
    createIntentQueue<boolean, { likeCount: number } | null, FeedItemDto>({
      send: async (itemId, liked) => {
        const res = await fetch('/api/likes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId, liked }),
        })
        if (res.status === 401) {
          if (liked) writeStorage(sessionStorage, PENDING_LIKE_KEY, itemId)
          await redirectToLogin(res)
          return null
        }
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as { likeCount: number }
      },
      onSettled: (itemId, liked, result) => {
        if (result) patchItem(itemId, { liked, likeCount: result.likeCount })
      },
      onFailed: (itemId, base, confirmed) => {
        patchItem(itemId, {
          liked: confirmed?.value ?? base.liked,
          likeCount: confirmed?.result?.likeCount ?? base.likeCount,
        })
        toastRef.current.show(
          navigator.onLine
            ? 'Could not save your like. Try again.'
            : 'You are offline. Your like was not saved.',
          'error',
        )
      },
    }),
  )

  const [saveQueue] = useState(() =>
    createIntentQueue<boolean, boolean, FeedItemDto>({
      send: async (itemId, saved) => {
        const res = await fetch('/api/saves', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId, saved }),
        })
        if (res.status === 401) {
          await redirectToLogin(res)
          return false
        }
        if (!res.ok) throw new Error(String(res.status))
        return true
      },
      onSettled: (_itemId, saved, ok) => {
        if (ok) toastRef.current.show(saved ? 'Saved to your profile' : 'Removed from saved', 'ok')
      },
      onFailed: (itemId, base, confirmed) => {
        const saved = confirmed?.value ?? base.saved
        const delta = saved === base.saved ? 0 : saved ? 1 : -1
        patchItem(itemId, { saved, saveCount: Math.max(0, base.saveCount + delta) })
        toastRef.current.show(
          navigator.onLine ? 'Could not save this reel. Try again.' : 'You are offline.',
          'error',
        )
      },
    }),
  )

  const sendLike = useCallback(
    (item: FeedItemDto, liked: boolean) => {
      const queue = likeQueue
      const current = itemsRef.current.find((it) => it.id === item.id) ?? item
      setFlag(item.id, 'liked', liked)
      queue.set(item.id, liked, current)
      track({ name: liked ? 'like' : 'unlike', itemId: item.id })
    },
    [setFlag, likeQueue],
  )

  const toggleLike = useCallback(
    (item: FeedItemDto) => {
      const current = itemsRef.current.find((it) => it.id === item.id) ?? item
      const wanted = likeQueue.wanted(item.id) ?? current.liked
      sendLike(current, !wanted)
    },
    [sendLike, likeQueue],
  )

  const toggleSave = useCallback(
    (item: FeedItemDto) => {
      const queue = saveQueue
      const current = itemsRef.current.find((it) => it.id === item.id) ?? item
      const saved = !(queue.wanted(item.id) ?? current.saved)
      setFlag(item.id, 'saved', saved)
      queue.set(item.id, saved, current)
    },
    [setFlag],
  )

  const visible = useCallback(
    (list: FeedItemDto[], at: FeedScope) =>
      list.filter(
        (it) => !isSuppressed(feedback.current, it, { keep: aboutItemId, scopedTopic: at.topic }),
      ),
    [aboutItemId],
  )

  const applyFeed = useCallback(
    (feed: FeedResponse) => {
      const shown = visible(feed.items, scopeRef.current)
      setItems(shown)
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
        const target = shown.find((it) => it.id === pending)
        if (target && !target.liked) sendLike(target, true)
      }
    },
    [sendLike, visible],
  )

  const loadScope = useCallback(
    async (next: FeedScope) => {
      const id = ++requestId.current
      setPhase('loading')
      setActive(0)
      setMoreState('idle')
      try {
        const res = await fetch(feedUrl(next))
        if (!res.ok) throw new Error(String(res.status))
        const feed = (await res.json()) as FeedResponse
        if (id === requestId.current) applyFeed(feed)
      } catch {
        if (id === requestId.current) setPhase('error')
      }
    },
    [applyFeed],
  )

  const loadInitial = useCallback(() => loadScope(scopeRef.current), [loadScope])

  const initialRef = useRef(initial)
  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    feedback.current = parseFeedback(readStorage(localStorage, FEEDBACK_KEY))
    if (initialRef.current) applyFeed(initialRef.current)
    else void loadInitial()
  }, [applyFeed, loadInitial])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return
    loadingMore.current = true
    setMoreState('loading')
    try {
      const at = scopeRef.current
      const res = await fetch(feedUrl(at, cursor))
      if (!res.ok) throw new Error(String(res.status))
      const feed = (await res.json()) as FeedResponse
      if (at !== scopeRef.current) return
      setItems((cur) => {
        const seen = new Set(cur.map((it) => it.id))
        return [...cur, ...visible(feed.items, at).filter((it) => !seen.has(it.id))]
      })
      setCursor(feed.nextCursor)
      setMoreState('idle')
    } catch {
      setMoreState('failed')
    } finally {
      loadingMore.current = false
    }
  }, [cursor, visible])

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
  useEffect(() => {
    const current = items[active]
    if (phase !== 'ready' || !current) return
    const first = !urlSynced.current
    urlSynced.current = true
    if (first && window.location.pathname === '/') return
    const href = reelHref(current, scope)
    if (window.location.pathname + window.location.search !== href) {
      window.history.replaceState(null, '', href)
    }
    document.title = `${metaTitle(current.title)} | Reelset`
  }, [active, items, phase, scope])

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
      if (sourcesFor || pickerOpen || menuFor || detailsOpen) return
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
  }, [phase, active, goTo, toggleLike, sourcesFor, pickerOpen, menuFor, detailsOpen])

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

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const sync = () => setMobile(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const ctl = new AbortController()
    fetch('/api/feed/following', { signal: ctl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ following: string[] }>) : null))
      .then((data) => {
        if (!data) return
        setFollowed(data.following)
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [])

  const dismissHint = useCallback(() => {
    setShowHint(false)
    writeStorage(localStorage, SWIPE_HINT_KEY, '1')
  }, [])

  useEffect(() => {
    if (phase !== 'ready' || !mobile || items.length < 2) return
    if (readStorage(localStorage, SWIPE_HINT_KEY) !== null) return
    const timer = setTimeout(() => setShowHint(true), 1200)
    return () => clearTimeout(timer)
  }, [phase, mobile, items.length])

  useEffect(() => {
    if (active > 0 && showHint) dismissHint()
  }, [active, showHint, dismissHint])

  const [followQueue] = useState(() =>
    createIntentQueue<boolean, string[] | null, { followed: string[] }>({
      send: async (slug, following) => {
        const res = await fetch('/api/profile/follow', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic: slug, following }),
        })
        if (res.status === 401) {
          await redirectToLogin(res)
          return null
        }
        if (res.status === 409) throw new Error('full')
        if (!res.ok) throw new Error(String(res.status))
        return ((await res.json()) as { topics: string[] }).topics
      },
      onSettled: (slug, following, topics) => {
        if (!topics) {
          setFollowed((cur) => cur.filter((t) => t !== slug))
          return
        }
        setFollowed(topics)
        if (following) toastRef.current.show('Following. See more of this in your feed.', 'ok')
      },
      onFailed: (slug, base) => {
        setFollowed(base.followed)
        toastRef.current.show('Could not update this topic. Try again.', 'error')
      },
    }),
  )

  const followTopic = useCallback(
    (slug: string) => {
      const wanted = !(followQueue.wanted(slug) ?? followed.includes(slug))
      if (wanted && !followQueue.wanted(slug) && followed.length >= MAX_FOLLOWED_TOPICS) {
        toast.show('You follow 8 topics already. Manage them in your profile.', 'info')
        return
      }
      setFollowed((cur) =>
        wanted ? (cur.includes(slug) ? cur : [...cur, slug]) : cur.filter((t) => t !== slug),
      )
      followQueue.set(slug, wanted, { followed })
    },
    [followed, followQueue, toast],
  )

  const giveFeedback = useCallback(
    (item: FeedItemDto, fewer: boolean) => {
      let next = hideItem(feedback.current, item.id)
      if (fewer) next = muteTopics(next, item.topics)
      feedback.current = next
      writeStorage(localStorage, FEEDBACK_KEY, JSON.stringify(next))
      setItems((cur) => cur.filter((it) => it.id !== item.id))
      setMenuFor(null)
      toast.show(fewer ? 'Got it. You will see fewer like this.' : 'Got it. Reel hidden.', 'ok')
    },
    [toast],
  )

  const shell = (children: React.ReactNode, canNavigate = false) => (
    <div className="h-dvh w-full lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-10 lg:pr-8">
      <SideRail authenticated={viewer.authenticated} />

      <div className="relative h-dvh w-full overflow-hidden bg-black [--bar:calc(3.5rem+env(safe-area-inset-bottom))] lg:my-4 lg:h-[calc(100dvh-2rem)] lg:w-[calc((100dvh-2rem)*9/16)] lg:rounded-[28px] lg:border lg:border-line lg:shadow-[0_24px_80px_-20px_rgba(0,0,0,.8)] lg:[--bar:0px]">
        {children}
        {sourcesFor && <SourcesSheet item={sourcesFor} onClose={() => setSourcesFor(null)} />}
        {menuFor && (
          <FeedbackMenu
            onNotInterested={() => giveFeedback(menuFor, false)}
            onShowFewer={() => giveFeedback(menuFor, true)}
            onClose={() => setMenuFor(null)}
          />
        )}
        {detailsOpen && items[active] && (
          <DetailsSheet
            item={items[active]}
            viewRule={countRules.views}
            onClose={() => setDetailsOpen(false)}
          />
        )}
        {showHint && !sourcesFor && !menuFor && !detailsOpen && <SwipeHint onDone={dismissHint} />}
        {pickerOpen && (
          <TopicPicker
            onDone={() => {
              writeStorage(localStorage, TOPICS_DISMISSED_KEY, '1')
              setPickerOpen(false)
            }}
          />
        )}
      </div>

      <aside className="hidden h-dvh min-h-0 flex-col items-start justify-end gap-6 py-10 lg:flex">
        {items[active] && (
          <div
            style={{ maskImage: FADE, WebkitMaskImage: FADE }}
            className="no-scrollbar min-h-0 w-80 shrink overflow-y-auto pb-6"
          >
            {about && items[active].id === aboutItemId ? about : <ReelAbout item={items[active]} />}
          </div>
        )}
        {canNavigate && (
          <div className="flex shrink-0 flex-col gap-2">
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
        <dl className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-faint">
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
      <BottomTabs translucent authenticated={viewer.authenticated} />
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
          onOpenDetails={() => setDetailsOpen(true)}
          onOpenMenu={setMenuFor}
          onFollow={followTopic}
          followed={followed}
          mobile={mobile}
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
        <section className="grid h-full snap-start place-items-center bg-surface px-8 pb-[var(--bar,0px)] text-center">
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
