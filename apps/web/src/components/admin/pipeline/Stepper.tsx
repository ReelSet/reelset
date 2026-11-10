import type { Step } from '@/lib/admin/pipeline'

const DOT: Record<Step['state'], string> = {
  done: 'bg-ok border-ok text-bg',
  active: 'bg-info border-info text-bg animate-pulse-ring',
  pending: 'border-line-strong text-faint',
  failed: 'bg-danger border-danger text-bg',
}

const LINE: Record<Step['state'], string> = {
  done: 'bg-ok/60',
  active: 'bg-line-strong',
  pending: 'bg-line',
  failed: 'bg-line',
}

export function Stepper({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  return (
    <ol className="flex items-start" aria-label="Pipeline progress">
      {steps.map((step, i) => (
        <li
          key={step.key}
          className="flex min-w-0 flex-1 flex-col items-center"
          aria-current={step.state === 'active' ? 'step' : undefined}
        >
          <div className="flex w-full items-center">
            <span
              className={`h-px flex-1 ${i === 0 ? 'bg-transparent' : LINE[steps[i - 1]?.state ?? 'pending']}`}
            />
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${DOT[step.state]}`}
            >
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : ''}
            </span>
            <span
              className={`h-px flex-1 ${i === steps.length - 1 ? 'bg-transparent' : LINE[step.state]}`}
            />
          </div>
          <span
            className={`mt-1 truncate text-[10px] ${compact && step.state !== 'active' && step.state !== 'failed' ? 'hidden sm:block' : ''} ${
              step.state === 'active'
                ? 'text-info'
                : step.state === 'failed'
                  ? 'text-danger'
                  : 'text-faint'
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  )
}
