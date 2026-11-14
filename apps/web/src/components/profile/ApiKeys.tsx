'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiFailure, createKey, listKeys, revokeKey } from '@/components/generate/api'
import { CopyButton } from '@/components/generate/CopyButton'
import { timeAgo } from '@/components/generate/format'
import { KeyIcon, WarnIcon } from '@/components/ui/icons'
import type { ApiKeyDto } from '@/lib/generate/types'

type Props = { onToken?: (token: string | null) => void }

export function ApiKeys({ onToken }: Props) {
  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await listKeys()
      setKeys(Array.isArray(res) ? res : res.keys)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load keys.')
      setKeys([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await createKey(trimmed)
      setToken(res.token)
      onToken?.(res.token)
      setKeys((prev) => [res.key, ...(prev ?? [])])
      setName('')
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Could not create the key.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    try {
      await revokeKey(id)
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== id))
      setConfirming(null)
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Could not revoke the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {token && (
        <div role="status" className="rounded-md border border-accent/40 bg-accent/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            <WarnIcon className="h-4 w-4 text-warn" />
            Copy your key now. You will not see it again.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-line bg-bg p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-accent">{token}</code>
            <CopyButton text={token} label="Copy key" className="shrink-0" />
          </div>
          <button
            type="button"
            onClick={() => {
              setToken(null)
              onToken?.(null)
            }}
            className="mt-3 text-xs text-muted underline hover:text-fg"
          >
            I have saved it
          </button>
        </div>
      )}

      <form onSubmit={create} className="flex gap-2">
        <label htmlFor="key-name" className="sr-only">
          Key name
        </label>
        <input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Key name, e.g. Claude Code"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-[16px] placeholder:text-faint sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-11 shrink-0 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg transition active:scale-95 disabled:opacity-50"
        >
          Create key
        </button>
      </form>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {keys === null ? (
        <p className="text-sm text-faint">Loading keys...</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-faint">No keys yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {keys.map((k) => (
            <li
              key={k.id}
              className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3"
            >
              <KeyIcon className="h-[18px] w-[18px] shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.name}</p>
                <p className="truncate font-mono text-xs text-faint">
                  {k.prefix}... · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : 'never used'}
                </p>
              </div>
              {confirming === k.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(k.id)}
                    className="min-h-9 rounded-full bg-danger/15 px-3 text-xs font-medium text-danger transition active:scale-95"
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="min-h-9 rounded-full px-3 text-xs text-muted hover:text-fg"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(k.id)}
                  aria-label={`Revoke ${k.name}`}
                  className="min-h-9 shrink-0 rounded-full px-3 text-xs text-muted transition hover:bg-raised hover:text-danger"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
