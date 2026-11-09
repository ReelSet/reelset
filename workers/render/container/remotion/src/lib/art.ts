import type { ReelProps, Source } from './types'

export const ART_KINDS = [
  'network',
  'terminal',
  'gitgraph',
  'bars',
  'paper',
  'timeline',
  'thread',
] as const
export type ArtKind = (typeof ART_KINDS)[number]

const SOURCE_PRIOR: Record<Source, ArtKind> = {
  github: 'gitgraph',
  youtube: 'timeline',
  reddit: 'thread',
  hn: 'thread',
  papers: 'paper',
  news: 'network',
}

const KEYWORDS: Record<ArtKind, string[]> = {
  network: [
    'ai',
    'llm',
    'llms',
    'model',
    'models',
    'neural',
    'agent',
    'agents',
    'gpt',
    'claude',
    'gemini',
    'training',
    'transformer',
    'inference',
    'embedding',
    'embeddings',
    'diffusion',
    'openai',
    'anthropic',
    'learning',
    'reasoning',
    'multimodal',
  ],
  terminal: [
    'cli',
    'terminal',
    'command',
    'shell',
    'bash',
    'npm',
    'install',
    'compiler',
    'runtime',
    'rust',
    'zig',
    'golang',
    'python',
    'typescript',
    'javascript',
    'api',
    'sdk',
    'framework',
    'library',
    'debug',
    'linux',
    'kernel',
    'docker',
    'kubernetes',
    'database',
    'sql',
    'postgres',
    'build',
  ],
  gitgraph: [
    'github',
    'repo',
    'repository',
    'commit',
    'commits',
    'branch',
    'merge',
    'pull',
    'git',
    'fork',
    'release',
    'opensource',
    'maintainer',
    'maintainers',
    'contributors',
  ],
  bars: [
    'benchmark',
    'benchmarks',
    'faster',
    'slower',
    'percent',
    'speedup',
    'throughput',
    'latency',
    'performance',
    'compared',
    'scores',
    'accuracy',
    'cost',
    'cheaper',
    'fps',
    'tokens',
    'vs',
  ],
  paper: [
    'paper',
    'papers',
    'research',
    'researchers',
    'arxiv',
    'study',
    'dataset',
    'abstract',
    'theorem',
    'propose',
    'preprint',
    'findings',
    'experiments',
  ],
  timeline: [
    'video',
    'talk',
    'watch',
    'tutorial',
    'keynote',
    'conference',
    'stream',
    'episode',
    'podcast',
    'lecture',
    'demo',
    'walkthrough',
  ],
  thread: [
    'discussion',
    'comments',
    'thread',
    'debate',
    'opinion',
    'users',
    'community',
    'reddit',
    'argue',
    'people',
    'devs',
    'developers',
  ],
}

// Sources with a strong identity (repo, video, paper) pin their motif; feeds are mostly generic.
const SOURCE_WEIGHT: Record<Source, number> = {
  github: 5,
  youtube: 5,
  papers: 5,
  reddit: 2,
  hn: 2,
  news: 1,
}
const KEYWORD_CAP = 4
const TITLE_WEIGHT = 2
const STOP = new Set(['the', 'a', 'an', 'new', 'how', 'why', 'what', 'show'])

export function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z0-9]*|%/g) ?? []
}

export function rankArt(input: {
  source: Source
  title: string
  texts: string[]
  visualTypes: string[]
}): ArtKind[] {
  const score = Object.fromEntries(ART_KINDS.map((k) => [k, 0])) as Record<ArtKind, number>
  score[SOURCE_PRIOR[input.source]] += SOURCE_WEIGHT[input.source]
  const title = new Set(words(input.title))
  const body = new Set(input.texts.flatMap(words))
  for (const kind of ART_KINDS) {
    let hits = 0
    for (const word of KEYWORDS[kind]) {
      if (title.has(word)) hits += TITLE_WEIGHT
      else if (body.has(word)) hits += 1
    }
    score[kind] += Math.min(KEYWORD_CAP, hits)
  }
  if (body.has('%') || title.has('%')) score.bars += 1
  const typed = (t: string) => Math.min(4, 2 * input.visualTypes.filter((v) => v === t).length)
  score.bars += typed('stat')
  score.terminal += typed('code')
  return [...ART_KINDS].sort(
    (a, b) => score[b] - score[a] || ART_KINDS.indexOf(a) - ART_KINDS.indexOf(b),
  )
}

export function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type ArtPlan = { ranked: ArtKind[]; seed: number; tool: string }

export function toolName(title: string): string {
  const repo = title.match(/[\w.-]+\/([A-Za-z0-9][\w.-]*)/)?.[1]
  const first = title.match(/[A-Za-z][A-Za-z0-9]+/g)?.find((w) => !STOP.has(w.toLowerCase()))
  return (repo ?? first ?? 'app').toLowerCase().slice(0, 14)
}

export function planArt(props: Pick<ReelProps, 'source' | 'title' | 'scenes'>): ArtPlan {
  const texts: string[] = []
  const visualTypes: string[] = []
  for (const scene of props.scenes) {
    texts.push(scene.text)
    if (scene.kind !== 'beat') continue
    const v = scene.visual
    visualTypes.push(v.type)
    if (v.type === 'title') texts.push(v.title, v.subtitle ?? '')
    if (v.type === 'stat') texts.push(v.label, v.value)
    if (v.type === 'code') texts.push(v.language)
  }
  return {
    ranked: rankArt({ source: props.source, title: props.title, texts, visualTypes }),
    seed: hashSeed(props.title),
    tool: toolName(props.title),
  }
}

// The reel rotates through the three best-fitting motifs; slot 0 (hook, outro) is the best fit.
export function artForSlot(plan: ArtPlan, slot: number): ArtKind {
  return plan.ranked[slot % 3] ?? 'network'
}
