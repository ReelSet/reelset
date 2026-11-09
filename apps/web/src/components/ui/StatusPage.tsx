import { LogoMark } from '@/components/ui/Logo'

export function StatusPage({
  code,
  title,
  body,
  children,
}: {
  code?: string
  title: string
  body: string
  children?: React.ReactNode
}) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="animate-fade-up relative">
        <LogoMark className="mx-auto h-12 w-12" />
        {code && <p className="mt-6 font-mono text-xs tracking-widest text-faint">{code}</p>}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{body}</p>
        <div className="mt-6 flex items-center justify-center gap-3">{children}</div>
      </div>
    </main>
  )
}

export const primaryBtn =
  'rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition active:scale-95'
export const ghostBtn =
  'rounded-full border border-line px-5 py-2.5 text-sm text-muted transition hover:bg-raised hover:text-fg active:scale-95'
