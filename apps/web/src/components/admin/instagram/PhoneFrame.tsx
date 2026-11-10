export function PhoneFrame({
  videoUrl,
  posterUrl,
  username,
  caption,
}: {
  videoUrl: string
  posterUrl: string | null
  username: string | null
  caption: string
}) {
  return (
    <div className="mx-auto w-full max-w-[15rem] lg:mx-0">
      <div className="rounded-[2rem] border border-line-strong bg-black p-2 shadow-[0_18px_40px_rgb(0_0_0/0.45)]">
        <div className="relative aspect-[9/19] overflow-hidden rounded-[1.5rem] bg-neutral-950">
          <video
            src={videoUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-3 pt-10 text-white">
            <p className="text-[11px] font-semibold">@{username ?? 'reelset'}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/85">{caption}</p>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-faint lg:text-left">
        Preview, roughly as it appears in Reels
      </p>
    </div>
  )
}
