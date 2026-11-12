export const SITE_URL = 'https://reelset.app'
export const SITE_NAME = 'Reelset'
export const SITE_TAGLINE = 'What developers are building, in 60-second reels.'
export const SITE_SUMMARY =
  'Reelset turns the developer stories trending on GitHub, Hacker News, Reddit, YouTube, ' +
  'research papers and tech news into 60-second vertical video reels, each with a written ' +
  'summary, a transcript and links to the original sources.'
// A topic page with fewer reels is thin content: it renders but is not indexed or listed.
export const MIN_INDEXED_TOPIC_REELS = 3
const DESCRIPTION_MAX_CHARS = 160
const TITLE_MAX_CHARS = 65

export function absoluteUrl(path: string): string {
  return new URL(path, SITE_URL).toString()
}

/** One-line description for meta tags: whole words, at most 160 chars. */
export function metaDescription(...candidates: (string | null | undefined)[]): string {
  return clip(candidates.find((c) => c && c.trim()) ?? SITE_TAGLINE, DESCRIPTION_MAX_CHARS, 80)
}

/** ISO 8601 duration (PT1M5S) for VideoObject and video sitemaps. */
export function isoDuration(ms: number | null | undefined): string | undefined {
  if (!ms || ms <= 0) return undefined
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `PT${minutes ? `${minutes}M` : ''}${seconds || !minutes ? `${seconds}S` : ''}`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function clip(text: string, max: number, minBoundary: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > minBoundary ? cut.slice(0, boundary) : cut).replace(/[\s,.;:]+$/, '')}…`
}

/** Title for <title> and og:title: search results show about 60 chars, the page h1 keeps it all. */
export function metaTitle(title: string): string {
  const firstClause = title.split(/(?<=[a-z0-9)])[:;] /i)[0] ?? title
  return clip(firstClause.length >= 25 ? firstClause : title, TITLE_MAX_CHARS, 30)
}

const ACRONYMS: Record<string, string> = {
  ai: 'AI',
  llm: 'LLM',
  llms: 'LLMs',
  api: 'API',
  apis: 'APIs',
  ui: 'UI',
  ux: 'UX',
  gpu: 'GPU',
  gpus: 'GPUs',
  cpu: 'CPU',
  sql: 'SQL',
  css: 'CSS',
  html: 'HTML',
  aws: 'AWS',
  gcp: 'GCP',
  ml: 'ML',
  cli: 'CLI',
  os: 'OS',
  ssh: 'SSH',
  http: 'HTTP',
  mcp: 'MCP',
  rag: 'RAG',
  devops: 'DevOps',
  macos: 'macOS',
  ios: 'iOS',
  github: 'GitHub',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  openai: 'OpenAI',
  webassembly: 'WebAssembly',
  wasm: 'Wasm',
  postgresql: 'PostgreSQL',
  vscode: 'VS Code',
  nlp: 'NLP',
  cuda: 'CUDA',
  iot: 'IoT',
  saas: 'SaaS',
  oss: 'OSS',
}

/** Display form of a raw lowercase topic tag: "ai agents" -> "AI Agents". */
export function topicLabel(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map(
      (w) =>
        ACRONYMS[w.toLowerCase()] ??
        (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w),
    )
    .join(' ')
}
