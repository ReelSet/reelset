import type { GateMode } from '@reelset/core'
import Link from 'next/link'
import { button } from '@/components/admin/primitives'
import { GATE_MIGRATION_FIRST, GATE_MODE_COPY } from '@/lib/admin/gate-view'
import { ADMIN_ROUTES } from '@/lib/admin/nav'

const TONE: Record<GateMode, { box: string; dot: string }> = {
  off: { box: 'border-line', dot: 'bg-faint' },
  shadow: { box: 'border-info/30 bg-info/5', dot: 'bg-info' },
  live: { box: 'border-ok/30 bg-ok/5', dot: 'bg-ok' },
}

/** States the gate's mode and what that means right now, with the way to change it; warns when the migration is missing. */
export function GateModeBanner({ mode, migrated }: { mode: GateMode; migrated: boolean }) {
  const copy = GATE_MODE_COPY[mode]
  return (
    <div
      className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-[13px] ${TONE[mode].box}`}
    >
      <p className="min-w-0">
        <span
          aria-hidden
          className={`mr-2 inline-block size-1.5 rounded-full align-middle ${TONE[mode].dot}`}
        />
        <span className="font-medium">{copy.label}:</span>{' '}
        <span className="text-muted">{copy.sentence}</span>
        {migrated ? null : <span className="mt-1 block text-warn">{GATE_MIGRATION_FIRST}</span>}
      </p>
      <Link href={ADMIN_ROUTES.gateSettings} className={button}>
        Gate settings
      </Link>
    </div>
  )
}
