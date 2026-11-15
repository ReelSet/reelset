'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePreviewAllowed } from '@/lib/client/use-preview-allowed'
import { playingIndices, type ShowcaseReel } from '@/lib/showcase'
import { ShowcaseReelCard } from './ShowcaseReel'

const MOBILE_QUERY = '(max-width: 639px)'

export function ShowcaseRow({ reels }: { reels: readonly ShowcaseReel[] }) {
  const previewAllowed = usePreviewAllowed()
  const [ratios, setRatios] = useState<number[]>(() => reels.map(() => 0))
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const sync = () => setMobile(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const onRatio = useCallback((index: number, ratio: number) => {
    setRatios((prev) =>
      prev[index] === ratio ? prev : prev.map((r, i) => (i === index ? ratio : r)),
    )
  }, [])

  const playing = playingIndices(ratios, mobile)

  return (
    <div className="mx-auto flex w-full max-w-4xl snap-x snap-mandatory gap-4 overflow-x-auto px-5 py-8 [scrollbar-width:none] sm:justify-center sm:gap-6 sm:overflow-visible [&::-webkit-scrollbar]:hidden">
      {reels.map((reel, i) => (
        <ShowcaseReelCard
          key={reel.id}
          reel={reel}
          index={i}
          previewAllowed={previewAllowed}
          playing={playing.has(i)}
          onRatio={onRatio}
        />
      ))}
    </div>
  )
}
