import { MAX_VIEWS_PER_BATCH } from '@/lib/views'

const FLUSH_INTERVAL_MS = 5000

const seen = new Set<string>()
let queue: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let listening = false

function send(itemIds: string[]) {
  const body = JSON.stringify({ itemIds })
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/views', blob)) return
  void fetch('/api/views', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export function flushViews() {
  if (timer) clearTimeout(timer)
  timer = null
  while (queue.length > 0) send(queue.splice(0, MAX_VIEWS_PER_BATCH))
}

/** Queues one view per reel per page load; the server dedupes per viewer per day. */
export function queueView(itemId: string) {
  if (typeof window === 'undefined' || seen.has(itemId)) return
  seen.add(itemId)
  if (!listening) {
    listening = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushViews()
    })
    window.addEventListener('pagehide', flushViews)
  }
  queue.push(itemId)
  if (queue.length >= MAX_VIEWS_PER_BATCH) flushViews()
  else if (!timer) timer = setTimeout(flushViews, FLUSH_INTERVAL_MS)
}
