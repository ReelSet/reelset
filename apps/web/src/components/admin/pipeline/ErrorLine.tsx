import { describeError } from '@/lib/admin/pipeline'

export function ErrorLine({ raw }: { raw: string | null }) {
  const info = describeError(raw)
  if (!info || !raw) return null
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer list-none text-danger [&::-webkit-details-marker]:hidden">
        <span>{info.summary}</span>
        {info.hint ? <span className="text-faint"> · {info.hint}</span> : null}
        <span className="ml-1 text-faint underline-offset-2 group-open:hidden hover:underline">
          details
        </span>
      </summary>
      <p className="mt-1 break-words rounded bg-bg/60 p-2 font-mono text-[11px] text-muted">
        {raw}
      </p>
    </details>
  )
}
