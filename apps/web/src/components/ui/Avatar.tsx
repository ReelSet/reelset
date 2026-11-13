/* eslint-disable @next/next/no-img-element */
export function Avatar({
  url,
  initial,
  className = 'h-16 w-16 text-2xl',
}: {
  url: string | null
  initial: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full border border-line-strong bg-raised font-semibold text-accent ${className}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  )
}
