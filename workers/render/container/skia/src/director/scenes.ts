export type SceneTone = 'dark' | 'light' | 'lime'

/** A scene as the model wrote it (untrusted shape). */
export type RawScene = {
  t0?: unknown
  fn?: unknown
  cap?: unknown
  tone?: unknown
  vid?: { clip?: unknown; grade?: unknown } | null
  exit?: unknown
}

export type SceneFn = (t: number, lt: number, X: unknown) => void

export type Scene = {
  t0: number
  t1: number
  fn: SceneFn
  cap: boolean
  tone: SceneTone
  clip: number | null
  grade: string
  exit: 'up' | null
}

export const GRADES: Record<string, string> = {
  lime: 'format=gray,eq=contrast=1.3:brightness=0.03,format=rgb24,colorchannelmixer=rr=0.8:gg=0.98:bb=0.3',
  warm: 'eq=contrast=1.12:saturation=0.85:brightness=-0.03,colorbalance=rs=-0.03:bs=0.05:rm=0.04:bm=-0.03',
  dim: 'eq=saturation=0.45:contrast=1.08:brightness=-0.05',
  none: 'null',
}
const DEFAULT_GRADE = 'dim'
const MIN_SCENE_SECONDS = 0.1
const TONES: Record<string, SceneTone> = { ink: 'dark', bone: 'light', lime: 'lime' }

const gradeOf = (name: unknown): string =>
  GRADES[typeof name === 'string' ? name : DEFAULT_GRADE] ?? GRADES[DEFAULT_GRADE]!

function clipOf(vid: RawScene['vid'], clipCount: number): number | null {
  const clip = vid?.clip
  return typeof clip === 'number' && Number.isInteger(clip) && clip >= 0 && clip < clipCount
    ? clip
    : null
}

/** Sorts, drops unusable scenes and makes the rest cover [0, duration] contiguously. Throws when none survive. */
export function normalizeScenes(raw: unknown, duration: number, clipCount: number): Scene[] {
  if (!Array.isArray(raw)) throw new Error('script did not return an array of scenes')
  const usable = (raw as RawScene[])
    .filter(
      (s) =>
        s &&
        typeof s.fn === 'function' &&
        typeof s.t0 === 'number' &&
        Number.isFinite(s.t0) &&
        s.t0 < duration - MIN_SCENE_SECONDS,
    )
    .sort((a, b) => (a.t0 as number) - (b.t0 as number))
  const kept: RawScene[] = []
  let lastStart = -Infinity
  for (const s of usable) {
    const start = kept.length === 0 ? 0 : Math.max(0, s.t0 as number)
    if (start - lastStart < MIN_SCENE_SECONDS) continue
    kept.push({ ...s, t0: start })
    lastStart = start
  }
  if (kept.length === 0) throw new Error('script returned no usable scenes')
  return kept.map((s, i) => ({
    t0: s.t0 as number,
    t1: i + 1 < kept.length ? (kept[i + 1]!.t0 as number) : duration,
    fn: s.fn as SceneFn,
    cap: s.cap !== false,
    tone: TONES[String(s.tone)] ?? 'dark',
    clip: clipOf(s.vid, clipCount),
    grade: s.vid ? gradeOf(s.vid.grade) : GRADES[DEFAULT_GRADE]!,
    exit: s.exit === 'up' ? 'up' : null,
  }))
}
