import { CheckIcon, CloseIcon } from '@/components/ui/icons'
import type { GenerateStep, ReelRequestDto } from '@/lib/generate/types'
import { clock } from './format'

const DOT: Record<GenerateStep['state'], string> = {
  done: 'bg-accent text-accent-fg',
  active: 'bg-accent/15 text-accent ring-1 ring-accent animate-pulse-ring',
  todo: 'bg-raised text-faint ring-1 ring-line',
  failed: 'bg-danger/15 text-danger ring-1 ring-danger',
}

function Dot({ state, size }: { state: GenerateStep['state']; size: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${size} ${DOT[state]}`}
    >
      {state === 'done' && <CheckIcon className="h-[60%] w-[60%]" />}
      {state === 'failed' && <CloseIcon className="h-[60%] w-[60%]" />}
      {state === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
    </span>
  )
}

function currentStep(steps: GenerateStep[]): GenerateStep | undefined {
  return (
    steps.find((s) => s.state === 'failed') ??
    steps.find((s) => s.state === 'active') ??
    [...steps].reverse().find((s) => s.state === 'done')
  )
}

export function waitingText(r: ReelRequestDto): string | null {
  if (r.aheadOfYou === null || r.status === 'done' || r.status === 'failed') return null
  return r.aheadOfYou === 0 ? 'Next up' : `${r.aheadOfYou} ahead of you`
}

/** Five dots on a rail with the current step named underneath. */
export function CompactStepper({ request }: { request: ReelRequestDto }) {
  const { steps } = request
  const cur = currentStep(steps)
  const wait = waitingText(request)
  return (
    <div>
      <ol className="flex items-center" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center last:flex-none">
            <Dot state={s.state} size="h-4 w-4" />
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`mx-1 h-px flex-1 ${s.state === 'done' ? 'bg-accent/60' : 'bg-line-strong'}`}
              />
            )}
            <span className="sr-only">
              {s.label}: {s.state}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-xs text-muted" aria-live="polite">
        <span className={cur?.state === 'failed' ? 'text-danger' : 'text-fg'}>
          {cur?.label ?? 'Queued'}
        </span>
        {wait && <span className="text-faint"> · {wait}</span>}
      </p>
    </div>
  )
}

export function BigStepper({ request }: { request: ReelRequestDto }) {
  const { steps } = request
  const wait = waitingText(request)
  return (
    <ol className="relative" aria-label="Progress">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        const at = clock(s.at)
        return (
          <li key={s.key} className="relative flex gap-4 pb-7 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px ${
                  s.state === 'done' ? 'bg-accent/50' : 'bg-line-strong'
                }`}
              />
            )}
            <Dot state={s.state} size="h-8 w-8" />
            <div className="min-w-0 pt-1">
              <p
                className={`text-[15px] font-medium leading-tight ${
                  s.state === 'todo'
                    ? 'text-faint'
                    : s.state === 'failed'
                      ? 'text-danger'
                      : 'text-fg'
                }`}
              >
                {s.label}
              </p>
              <p className="mt-1 text-xs text-faint">
                {s.state === 'active' && s.key === 'queued' && wait
                  ? wait
                  : s.state === 'active'
                    ? 'In progress'
                    : s.state === 'failed'
                      ? 'Stopped here'
                      : at
                        ? at
                        : ''}
                {s.state === 'active' && at ? ` · since ${at}` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
