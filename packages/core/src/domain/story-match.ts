const STOP_WORDS = new Set(
  'a an and are as at be by for from has have in into is it its of on or over the this to was were what who why with how after amid about new now just says said than that will'.split(
    ' ',
  ),
)

const MIN_CONTAINED = 0.8
const MIN_OVERLAP = 0.6
const MIN_WORDS = 3

function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word
}

/** The words that carry a headline's story: lower case, no stop words, plural s dropped. */
export function storyWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}.-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP_WORDS.has(w))
  return new Set(words.map(stem))
}

/**
 * Whether two headlines tell the same story (two Reddit posts of one announcement). Short titles,
 * such as repo names, only match when their words are identical.
 */
export function sameStory(a: string, b: string): boolean {
  const x = storyWords(a)
  const y = storyWords(b)
  if (x.size === 0 || y.size === 0) return false
  const shared = [...x].filter((w) => y.has(w)).length
  const smaller = Math.min(x.size, y.size)
  if (smaller < MIN_WORDS) return shared === x.size && shared === y.size
  const union = x.size + y.size - shared
  return shared / smaller >= MIN_CONTAINED || shared / union >= MIN_OVERLAP
}
