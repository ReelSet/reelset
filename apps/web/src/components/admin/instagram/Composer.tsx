'use client'

import { useMemo, useRef, useState } from 'react'
import { INSTAGRAM_CAPTION_MAX_CHARS, INSTAGRAM_HASHTAG_MAX } from '@/lib/instagram/limits'
import { checkCaption, normalizeCaption } from '@/lib/instagram/caption'
import { ConfirmForm } from './ConfirmForm'
import { PhoneFrame } from './PhoneFrame'

type Props = {
  itemId: string
  title: string
  videoUrl: string
  posterUrl: string | null
  draftCaption: string
  username: string | null
  returnTo: string
  blockedReason: string | null
  notice: string | null
  queueAction: (formData: FormData) => void | Promise<void>
}

function Counter({ used, max, label }: { used: number; max: number; label: string }) {
  const over = used > max
  return (
    <span
      className={`tabular-nums ${over ? 'text-danger' : used > max * 0.9 ? 'text-warn' : 'text-faint'}`}
    >
      {used}/{max} {label}
    </span>
  )
}

export function Composer({
  itemId,
  title,
  videoUrl,
  posterUrl,
  draftCaption,
  username,
  returnTo,
  blockedReason,
  notice,
  queueAction,
}: Props) {
  const [caption, setCaption] = useState(draftCaption)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const check = useMemo(() => checkCaption(normalizeCaption(caption)), [caption])
  const invalid = check.errors.length > 0
  const disabled = invalid || blockedReason !== null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0 space-y-3">
        <div>
          <label htmlFor="ig-caption" className="text-xs font-medium text-muted">
            Caption
          </label>
          <textarea
            id="ig-caption"
            ref={textarea}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={9}
            spellCheck
            aria-invalid={invalid}
            aria-describedby="ig-caption-help"
            className="mt-1.5 w-full resize-y rounded-md border border-line bg-bg px-3 py-2.5 text-[13px] leading-relaxed outline-none transition focus:border-line-strong aria-[invalid=true]:border-danger/60"
          />
          <div
            id="ig-caption-help"
            className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span className="flex gap-3">
              <Counter used={check.chars} max={INSTAGRAM_CAPTION_MAX_CHARS} label="characters" />
              <Counter used={check.hashtags} max={INSTAGRAM_HASHTAG_MAX} label="hashtags" />
            </span>
            <button
              type="button"
              onClick={() => setCaption(draftCaption)}
              className="text-faint underline-offset-2 transition hover:text-fg hover:underline"
            >
              Reset to suggested
            </button>
          </div>
          {invalid ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {check.errors[0]}
            </p>
          ) : null}
        </div>

        {blockedReason || notice ? <p className="text-xs text-warn">{blockedReason ?? notice}</p> : null}

        <ConfirmForm
          action={queueAction}
          fields={{ itemId, caption: normalizeCaption(caption), returnTo }}
          triggerLabel="Queue post"
          title="Post this reel to Instagram?"
          confirmLabel="Queue post"
          pendingLabel="Queuing"
          triggerClassName={`inline-flex items-center rounded-md bg-accent px-3.5 py-2 text-xs font-medium text-accent-fg transition active:scale-95 ${
            disabled ? 'pointer-events-none opacity-40' : ''
          }`}
        >
          <p className="text-[13px] text-muted">
            This publishes to {username ? `@${username}` : 'the connected account'} as a public
            reel. Clicking confirm is your approval for exactly this post.
          </p>
          <div className="rounded-md border border-line bg-bg p-3 text-xs">
            <p className="mb-1 font-medium">{title}</p>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-muted">
              {normalizeCaption(caption)}
            </p>
          </div>
          <p className="text-xs text-faint">
            {check.chars} characters, {check.hashtags} hashtags. You can cancel it from the queue
            until it starts.
          </p>
        </ConfirmForm>
      </div>

      <PhoneFrame videoUrl={videoUrl} posterUrl={posterUrl} username={username} caption={caption} />
    </div>
  )
}
