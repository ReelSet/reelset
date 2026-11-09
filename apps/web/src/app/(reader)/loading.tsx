import { ReelSkeleton } from '@/components/feed/ReelSkeleton'

export default function Loading() {
  return (
    <div className="relative h-dvh w-full bg-black lg:mx-auto lg:my-4 lg:h-[calc(100dvh-2rem)] lg:w-[calc((100dvh-2rem)*9/16)] lg:rounded-[28px] lg:border lg:border-line">
      <ReelSkeleton />
    </div>
  )
}
