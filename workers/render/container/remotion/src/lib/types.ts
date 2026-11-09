export type Source = 'hn' | 'github' | 'news' | 'reddit' | 'youtube' | 'papers'

export type Word = { text: string; start: number; end: number }

export type Visual =
  | { type: 'title'; title: string; subtitle?: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'stat'; label: string; value: string }
  | { type: 'quote'; text: string; attribution: string }
  | { type: 'image' }

export type Scene =
  | { kind: 'hook'; start: number; end: number; text: string }
  | { kind: 'beat'; start: number; end: number; text: string; visual: Visual }
  | { kind: 'outro'; start: number; end: number; text: string }

export type ReelProps = {
  durationSeconds: number
  title: string
  source: Source
  sourceLabel: string
  domain: string
  scenes: Scene[]
  words: Word[]
  audio: string
  cover?: string
}

export type TimedScene = Scene & { from: number; frames: number }
