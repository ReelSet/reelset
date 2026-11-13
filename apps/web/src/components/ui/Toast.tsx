'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

type Tone = 'ok' | 'error' | 'info'
type ToastItem = { id: number; tone: Tone; message: string }
type ToastApi = { show: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi>({ show: () => undefined })

export const useToast = () => useContext(ToastContext)

const TONE: Record<Tone, string> = {
  ok: 'border-ok/30 text-ok',
  error: 'border-danger/40 text-danger',
  info: 'border-line-strong text-fg',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [online, setOnline] = useState(true)
  const nextId = useRef(0)

  const show = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++nextId.current
    setToasts((cur) => [
      ...cur.filter((t) => t.message !== message).slice(-2),
      { id, tone, message },
    ])
    setTimeout(
      () => setToasts((cur) => cur.filter((t) => t.id !== id)),
      tone === 'error' ? 5000 : 3200,
    )
  }, [])

  useEffect(() => {
    setOnline(navigator.onLine)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {!online && (
        <div
          role="status"
          data-testid="offline-banner"
          className="animate-fade-in fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-[90] bg-warn px-4 py-2 text-center text-xs font-medium text-black lg:bottom-auto lg:top-0 lg:pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          You are offline. Reconnect to keep browsing.
        </div>
      )}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`animate-fade-up glass pointer-events-auto max-w-sm rounded-full px-4 py-2 text-[13px] shadow-lg ${TONE[t.tone]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
