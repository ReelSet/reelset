'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { NAV_AVATAR_CACHE } from '@/components/ui/AppNav'
import { Avatar } from '@/components/ui/Avatar'
import { CloseIcon } from '@/components/ui/icons'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { cropToAvatar, type PickedAvatar } from '@/lib/avatar-crop'
import { BIO_MAX, NAME_MAX } from '@/lib/profile-edit'

type Props = { name: string; bio: string | null; avatarUrl: string | null; initial: string }
type AvatarChange = { kind: 'keep' } | { kind: 'remove' } | ({ kind: 'set' } & PickedAvatar)

const ERRORS: Record<string, string> = {
  invalid: 'Check your name and bio.',
  too_large: 'That image is over 2 MB.',
  unsupported: 'Use a JPEG, PNG or WebP image.',
  rate_limited: 'Too many edits. Try again in a bit.',
  unauthorized: 'Sign in again to save.',
}

async function send(url: string, init: RequestInit): Promise<string | null> {
  const res = await fetch(url, init)
  if (res.ok) return null
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? 'failed'
}

export function EditProfile({ name, bio, avatarUrl, initial }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center rounded-full border border-line-strong px-3.5 py-1.5 text-xs font-medium text-fg transition hover:bg-raised active:scale-95"
      >
        Edit profile
      </button>
      {open && (
        <EditSheet
          name={name}
          bio={bio}
          avatarUrl={avatarUrl}
          initial={initial}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function EditSheet({ name, bio, avatarUrl, initial, onClose }: Props & { onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [nameValue, setNameValue] = useState(name)
  const [bioValue, setBioValue] = useState(bio ?? '')
  const [change, setChange] = useState<AvatarChange>({ kind: 'keep' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    return () => {
      if (change.kind === 'set') URL.revokeObjectURL(change.previewUrl)
    }
  }, [change])

  const shownUrl =
    change.kind === 'set' ? change.previewUrl : change.kind === 'remove' ? null : avatarUrl
  const trimmed = nameValue.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX && bioValue.length <= BIO_MAX

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setChange({ kind: 'set', ...(await cropToAvatar(file)) })
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(
        code === 'size'
          ? ERRORS.too_large!
          : code === 'type'
            ? ERRORS.unsupported!
            : 'Could not read that image.',
      )
    }
  }

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      let failure: string | null = null
      if (change.kind === 'set') {
        failure = await send('/api/profile/avatar', {
          method: 'POST',
          headers: { 'content-type': change.blob.type || 'image/webp' },
          body: change.blob,
        })
      } else if (change.kind === 'remove') {
        failure = await send('/api/profile/avatar', { method: 'DELETE' })
      }
      failure ??= await send('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, bio: bioValue.trim() || null }),
      })
      if (failure) {
        setError(ERRORS[failure] ?? 'Could not save your profile.')
        return
      }
      try {
        sessionStorage.removeItem(NAV_AVATAR_CACHE)
      } catch {}
      toast.show('Profile updated.', 'ok')
      router.refresh()
      onClose()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex flex-col justify-end bg-black/60 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up mx-auto flex max-h-[90dvh] w-full max-w-md flex-col overflow-y-auto rounded-t-[28px] border-t border-line bg-surface px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 sm:rounded-[28px] sm:border"
      >
        <div className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-white/15 sm:hidden" />
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Edit profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-raised text-muted transition hover:text-fg active:scale-90"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <Avatar
            url={shownUrl}
            initial={trimmed.charAt(0).toUpperCase() || initial}
            className="h-20 w-20 text-3xl"
          />
          <div className="flex flex-col items-start gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Choose a profile picture"
              onChange={(e) => {
                void pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-raised px-3.5 py-1.5 text-xs font-medium transition hover:bg-hover active:scale-95"
            >
              {shownUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {shownUrl && (
              <button
                type="button"
                onClick={() => setChange({ kind: 'remove' })}
                className="text-xs text-muted transition hover:text-danger"
              >
                Remove photo
              </button>
            )}
            <p className="text-[11px] text-faint">JPEG, PNG or WebP, up to 2 MB. Cropped square.</p>
          </div>
        </div>

        <label className="mt-5 block">
          <span className="text-xs font-medium text-muted">Name</span>
          <input
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            maxLength={NAME_MAX}
            autoComplete="name"
            required
            className="mt-1.5 w-full rounded-md border border-line bg-raised px-3 py-2.5 text-sm outline-none transition focus:border-accent"
          />
        </label>

        <label className="mt-4 block">
          <span className="flex justify-between text-xs font-medium text-muted">
            Bio{' '}
            <span className="text-faint">
              {bioValue.length}/{BIO_MAX}
            </span>
          </span>
          <textarea
            value={bioValue}
            onChange={(e) => setBioValue(e.target.value)}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="What do you build or read about?"
            className="mt-1.5 w-full resize-none rounded-md border border-line bg-raised px-3 py-2.5 text-sm outline-none transition placeholder:text-faint focus:border-accent"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-line py-2.5 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-accent py-2.5 text-sm font-semibold text-accent-fg transition active:scale-[0.99] disabled:opacity-50"
          >
            {saving && <Spinner />}
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
