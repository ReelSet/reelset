import { bare, isFunctionWord, isNumberWord, isVerbForm } from './text-rules'

/** Common verbs and auxiliaries that carry no content on their own ("takes", "runs", "try"). */
const WEAK = new Set(
  `take takes took taking run runs ran running try tries tried use uses used using make makes made
  get gets got go goes went do does did doesn't don't didn't can't won't isn't aren't wasn't
  is are was were be been has have had want wants need needs let lets keep keeps come comes
  give gives say says said see sees show shows mean means work works feel feels put puts
  set sets add adds call calls turn turns move moves start starts lets thing things way ways`
    .split(/\s+/)
    .filter(Boolean),
)

const isNumeral = (w: string) => /^[~$€£]?\d[\d,]*(?:\.\d+)*$/.test(w)
const hasUnit = (w: string) => /^[~$€£]?\d[\d,.]*(?:%|×|x|k|m|b|gb|mb|tb|ms|s|h)$/i.test(w)
const capitalised = (w: string) => /^\p{Lu}/u.test(w)
const endsSentence = (w: string) => /[.!?:]$/.test(w.trim())

/**
 * A number that names a product, model or version rather than measuring anything: "PyTorch 2.15",
 * "Krea 2", "RTX 5090", "v3", "1.2.3". `prev` is the word before it.
 */
export function isProductNumber(word: string, prev = ''): boolean {
  const w = bare(word)
  if (/^v\d+(?:\.\d+)*$/i.test(w) || /^\d+\.\d+\.\d+/.test(w)) return true
  if (!isNumeral(w) || hasUnit(w)) return false
  const p = bare(prev)
  if (/^(?:version|v|release|build|gen|generation|model|series|mk)$/i.test(p)) return true
  return Boolean(p) && capitalised(p) && !endsSentence(prev) && !/^\$/.test(w)
}

/**
 * How much a caption word deserves the accent box: 0 never (function words, common verbs, adverbs,
 * product and version numbers), 1 weak (number words like "one"), 2 a content word, 3 a real
 * number or a name ("94.7%", "MOPD", "outlook.com", "Fizgig" mid-sentence).
 */
export function wordStrength(word: string, prev = ''): number {
  const w = bare(word)
  if (!w || !/[\p{L}\p{N}]/u.test(w)) return 0
  const low = w.toLowerCase()
  if (isFunctionWord(low) || WEAK.has(low)) return 0
  if (/\d/.test(w)) {
    if (isProductNumber(word, prev)) return 0
    return isNumeral(w) || hasUnit(w) || /^\d/.test(w) ? 3 : 2
  }
  if (isNumberWord(low)) return 1
  if (isVerbForm(low)) return 0
  if (low.length > 4 && low.endsWith('ly')) return 0
  const nameLike =
    /\p{Lu}.*\p{Lu}/u.test(w) ||
    /[.@][\p{L}]/u.test(w) ||
    (capitalised(w) && Boolean(prev) && !endsSentence(prev))
  return nameLike ? 3 : 2
}

/** Index of the word a key point colours: its last strong word, never a version number. */
export function accentIndex(words: readonly string[]): number {
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (wordStrength(words[i]!, words[i - 1] ?? '') >= 2) return i
  }
  return -1
}
