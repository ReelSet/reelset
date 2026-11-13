import { topicSlug } from '@/lib/reel-url'

export type FeedbackState = { hidden: string[]; muted: string[] }

export const FEEDBACK_KEY = 'reelset.feedback'
const MAX_HIDDEN = 300
const MAX_MUTED = 24
const KEEP_ONE_IN = 3

export const emptyFeedback = (): FeedbackState => ({ hidden: [], muted: [] })

const strings = (value: unknown, max: number): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(-max) : []

export function parseFeedback(raw: string | null): FeedbackState {
  if (!raw) return emptyFeedback()
  try {
    const data = JSON.parse(raw) as Partial<FeedbackState> | null
    return { hidden: strings(data?.hidden, MAX_HIDDEN), muted: strings(data?.muted, MAX_MUTED) }
  } catch {
    return emptyFeedback()
  }
}

export function hideItem(state: FeedbackState, id: string): FeedbackState {
  if (state.hidden.includes(id)) return state
  return { ...state, hidden: [...state.hidden, id].slice(-MAX_HIDDEN) }
}

export function muteTopics(state: FeedbackState, topics: readonly string[]): FeedbackState {
  const muted = [...state.muted]
  for (const topic of topics) {
    const slug = topicSlug(topic)
    if (slug && !muted.includes(slug)) muted.push(slug)
  }
  return { ...state, muted: muted.slice(-MAX_MUTED) }
}

function bucket(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % KEEP_ONE_IN
}

/**
 * Hidden reels never return. Reels sharing a muted topic come back about one time in three:
 * "fewer like this", not none. `keep` names a reel that must stay (the one a shared link opened).
 */
export function isSuppressed(
  state: FeedbackState,
  item: { id: string; topics: readonly string[] },
  opts: { keep?: string | null; scopedTopic?: string | null } = {},
): boolean {
  if (item.id === opts.keep) return false
  if (state.hidden.includes(item.id)) return true
  if (state.muted.length === 0) return false
  const muted = item.topics.some((t) => {
    const slug = topicSlug(t)
    return state.muted.includes(slug) && slug !== opts.scopedTopic
  })
  return muted && bucket(item.id) !== 0
}
