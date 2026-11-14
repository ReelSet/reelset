export type RequestStepKey = 'queued' | 'reading' | 'script' | 'render' | 'ready'
export type RequestStepState = 'done' | 'active' | 'todo' | 'failed'
export type RequestStep = {
  key: RequestStepKey
  label: string
  state: RequestStepState
  at: string | null
}

export type RequestStepsInput = {
  requestStatus: 'pending' | 'resolving' | 'processing' | 'done' | 'failed'
  requestCreatedAt: Date | string
  itemStatus: string | null
  renderStatus: string | null
  renderFinishedAt?: Date | string | null
  events: readonly { stage: string; outcome: string; createdAt: Date | string }[]
}

const LABELS: Record<RequestStepKey, string> = {
  queued: 'Queued',
  reading: 'Reading sources',
  script: 'Writing script',
  render: 'Voice & render',
  ready: 'Ready',
}
const ORDER: RequestStepKey[] = ['queued', 'reading', 'script', 'render', 'ready']

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function eventAt(
  events: RequestStepsInput['events'],
  stage: string,
  outcome: string,
): string | null {
  let latest: string | null = null
  for (const e of events) {
    if (e.stage !== stage || e.outcome !== outcome) continue
    const at = iso(e.createdAt)
    if (at && (latest === null || at > latest)) latest = at
  }
  return latest
}

function failedStep(input: RequestStepsInput): RequestStepKey {
  if (input.itemStatus === 'insufficient_source') return 'reading'
  if (input.itemStatus === null) return 'reading'
  if (input.renderStatus === 'failed') return 'render'
  const failed = input.events
    .filter((e) => e.outcome === 'failed')
    .sort((a, b) => (iso(a.createdAt) ?? '').localeCompare(iso(b.createdAt) ?? ''))
    .at(-1)
  if (failed) {
    if (failed.stage === 'found' || failed.stage === 'summarized') return 'script'
    return 'render'
  }
  return 'script'
}

/** Maps a request, its item and latest render onto the five UI steps; at most one is active or failed. */
export function requestSteps(input: RequestStepsInput): RequestStep[] {
  const created = iso(input.requestCreatedAt)
  const at: Record<RequestStepKey, string | null> = {
    queued: created,
    reading: eventAt(input.events, 'found', 'started'),
    script: eventAt(input.events, 'summarized', 'ok'),
    render: null,
    ready: eventAt(input.events, 'rendered', 'ok') ?? iso(input.renderFinishedAt),
  }
  at.render = at.ready

  let reached: number
  let failed: RequestStepKey | null = null
  const status = input.requestStatus
  if (status === 'done') {
    reached = ORDER.length
  } else if (status === 'failed') {
    failed = failedStep(input)
    reached = ORDER.indexOf(failed)
  } else if (status === 'pending') {
    reached = 0
  } else if (status === 'resolving') {
    reached = 1
  } else {
    switch (input.itemStatus) {
      case 'found':
        reached = 2
        break
      case 'summarized':
      case 'embedded':
      case 'voiced':
        reached = 3
        break
      case 'rendered':
        reached = input.renderStatus === 'done' ? ORDER.length : 3
        break
      default:
        reached = 1
    }
  }

  return ORDER.map((key, index) => {
    let state: RequestStepState
    if (failed === key) state = 'failed'
    else if (index < reached) state = 'done'
    else if (index === reached && failed === null) state = 'active'
    else state = 'todo'
    return { key, label: LABELS[key], state, at: state === 'todo' ? null : at[key] }
  })
}
