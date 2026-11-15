export type SuggestedStage = 'found' | 'summarized' | 'embedded'

const RETRYABLE: readonly SuggestedStage[] = ['found', 'summarized', 'embedded']

// No worker re-enqueues `voiced` items, so a failure after voicing restarts from `embedded`.
export function suggestRetryStage(lastOkStage: string | null | undefined): SuggestedStage {
  if (lastOkStage === 'voiced') return 'embedded'
  return RETRYABLE.find((stage) => stage === lastOkStage) ?? 'found'
}
