import type { Scene, TimedScene } from './types'

export function toFrames(scenes: readonly Scene[], fps: number, total: number): TimedScene[] {
  const starts = scenes.map((s, i) => (i === 0 ? 0 : Math.round(s.start * fps)))
  return scenes.map((scene, i) => {
    const from = Math.min(starts[i] ?? 0, total - 1)
    const to = i + 1 < scenes.length ? Math.round((scenes[i + 1]?.start ?? 0) * fps) : total
    return { ...scene, from, frames: Math.max(1, to - from) }
  })
}

export function totalFrames(durationSeconds: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSeconds * fps))
}
