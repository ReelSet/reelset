export type Source = 'hn' | 'github' | 'news' | 'reddit' | 'youtube' | 'papers'

export type Word = { text: string; start: number; end: number }

export type Visual =
  | { type: 'title'; title: string; subtitle?: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'stat'; label: string; value: string }
  | { type: 'quote'; text: string; attribution: string }
  | { type: 'image' }

export const SCREEN_NAMES = [
  'RepoPage',
  'Terminal',
  'CodeBlock',
  'StatSlam',
  'BarRace',
  'HNThread',
  'RedditPost',
  'YouTubePlayer',
  'PaperPage',
  'FigureZoom',
  'TableScreen',
  'EquationScreen',
  'ArticleHeadline',
  'ImageFull',
  'KeyPoint',
  'Compare',
  'EndCard',
  'RepoDemo',
] as const
export type ScreenName = (typeof SCREEN_NAMES)[number]

export const SFX_NAMES = ['whoosh', 'pop', 'tick', 'ding', 'hit', 'riser', 'swoosh'] as const
export type SfxName = (typeof SFX_NAMES)[number]

/** One visual change. `at` is a spoken-word cue: 'word' (first match) or 'word#2' (second match). */
export type Shot = {
  at: string
  show: ScreenName
  props?: Record<string, unknown>
  sfx?: SfxName
  /** Seconds, resolved by the container from `at`; preferred over matching the cue here. */
  t?: number
}

export type Scene =
  | { kind: 'hook'; start: number; end: number; text: string; shots?: Shot[] }
  | { kind: 'beat'; start: number; end: number; text: string; visual: Visual; shots?: Shot[] }
  | { kind: 'outro'; start: number; end: number; text: string; shots?: Shot[] }

export type ImageKind = 'og' | 'thumbnail' | 'figure' | 'screenshot' | 'avatar'

export type ReelImage = {
  src: string
  kind: ImageKind
  width?: number
  height?: number
  alt?: string
  /** Vetted figure caption (<= 60 chars) and the point of interest (0-1) for the Ken Burns target. */
  caption?: string
  focus?: { x: number; y: number }
}

/** README demo clip converted to mp4 by the container; shown full-bleed by RepoDemo. */
export type ReelDemo = {
  src: string
  seconds: number
  width?: number
  height?: number
  repo: string
}

/** Real item metadata, all optional. A screen only shows a number that is present here or in the script. */
export type ItemFacts = {
  repo?: {
    owner?: string
    name?: string
    description?: string
    stars?: number
    forks?: number
    language?: string
    latestRelease?: string
    languages?: { name: string; pct: number }[]
    topics?: string[]
  }
  hn?: { points?: number; comments?: number; author?: string; topComment?: string }
  reddit?: { subreddit?: string; upvotes?: number; comments?: number; author?: string }
  youtube?: { channel?: string; views?: number; duration?: string }
  paper?: { authors?: string[]; abstract?: string; upvotes?: number }
  article?: { site?: string; author?: string }
}

/** A trimmed, muted stock clip prepared by the container for screen backdrops. */
export type BrollClip = {
  src: string
  seconds: number
  width?: number
  height?: number
  /** Narration scene index the clip was chosen for. */
  beat?: number
  creator?: string
  creatorUrl?: string
  pageUrl?: string
}

export type ReelProps = {
  durationSeconds: number
  title: string
  source: Source
  sourceLabel: string
  domain: string
  scenes: Scene[]
  words: Word[]
  audio: string
  headline?: string
  facts?: ItemFacts
  cover?: string
  images?: ReelImage[]
  broll?: BrollClip[]
  demo?: ReelDemo
  plan?: TimedShot[]
  sfx?: { t: number; name: SfxName }[]
}

/** A shot placed on the timeline. `sceneIndex` is the narration scene it belongs to. */
export type TimedShot = {
  from: number
  frames: number
  show: ScreenName
  props: Record<string, unknown>
  sfx?: SfxName
  sceneIndex: number
  origin: 'cue' | 'planned'
}

export type TimedScene = Scene & { from: number; frames: number }
