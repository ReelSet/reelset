'use client'

import { useEffect, useState } from 'react'

type NetworkInformation = { saveData?: boolean }

/** True once on the client when autoplaying video previews are acceptable (no reduced motion, no data saver). */
export function usePreviewAllowed(): boolean {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
      setAllowed(!motion.matches && connection?.saveData !== true)
    }
    update()
    motion.addEventListener('change', update)
    return () => motion.removeEventListener('change', update)
  }, [])
  return allowed
}
