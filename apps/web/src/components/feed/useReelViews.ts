import { useEffect } from 'react'
import { queueView } from '@/lib/client/views'
import { MIN_VIEW_MS } from '@/lib/views'

/** A reel counts as viewed once it has been the active reel of a visible page for 2 seconds. */
export function useReelViews(itemId: string | undefined) {
  useEffect(() => {
    if (!itemId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer || document.visibilityState !== 'visible') return
      timer = setTimeout(() => queueView(itemId), MIN_VIEW_MS)
    }
    const disarm = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? arm() : disarm())
    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disarm()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [itemId])
}
