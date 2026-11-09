import type { ClientEventName } from '@/lib/api-types'

type QueuedEvent = {
  name: ClientEventName
  itemId?: string
  meta?: Record<string, string | number | boolean>
}

const MAX_BATCH = 20
const FLUSH_INTERVAL_MS = 5000

let queue: QueuedEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let listening = false

function send(batch: QueuedEvent[]) {
  const body = JSON.stringify({ events: batch })
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
  if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/events', blob))
    return
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body,
    keepalive: true,
  }).catch(() => undefined)
}

export function flushEvents() {
  if (timer) clearTimeout(timer)
  timer = null
  while (queue.length > 0) send(queue.splice(0, MAX_BATCH))
}

export function track(event: QueuedEvent) {
  if (typeof window === 'undefined') return
  if (!listening) {
    listening = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushEvents()
    })
    window.addEventListener('pagehide', flushEvents)
  }
  queue.push(event)
  if (queue.length >= MAX_BATCH) flushEvents()
  else if (!timer) timer = setTimeout(flushEvents, FLUSH_INTERVAL_MS)
}
