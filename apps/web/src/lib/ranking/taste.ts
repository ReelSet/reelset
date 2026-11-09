import { EMBEDDING_DIMENSIONS } from '@reelset/core'

export const LIKE_WEIGHT = 1.0
export const COMPLETE_WEIGHT = 0.5
export const COMPLETE_MIN_WATCH_RATIO = 0.8

export type WeightedVector = { vector: readonly number[]; weight: number }

export function isQualifyingCompletion(name: string, meta: Record<string, unknown> | undefined) {
  if (name !== 'reel_complete') return false
  const ratio = meta?.watchRatio
  return typeof ratio === 'number' && ratio >= COMPLETE_MIN_WATCH_RATIO && ratio <= 1
}

export function weightedMean(inputs: readonly WeightedVector[]): number[] | null {
  const usable = inputs.filter(
    (i) => i.weight > 0 && Number.isFinite(i.weight) && i.vector.length === EMBEDDING_DIMENSIONS,
  )
  const total = usable.reduce((sum, i) => sum + i.weight, 0)
  if (usable.length === 0 || total === 0) return null

  const mean = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  for (const { vector, weight } of usable) {
    for (let d = 0; d < EMBEDDING_DIMENSIONS; d++)
      mean[d] = (mean[d] as number) + (vector[d] as number) * weight
  }
  return mean.map((v) => v / total)
}

export function l2Normalize(vector: readonly number[]): number[] | null {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  if (!Number.isFinite(norm) || norm === 0) return null
  return vector.map((v) => v / norm)
}

export function tasteVector(inputs: readonly WeightedVector[]): number[] | null {
  const mean = weightedMean(inputs)
  return mean ? l2Normalize(mean) : null
}
