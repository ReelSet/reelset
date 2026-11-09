export type SpendRow = { day: string; category: string; costUsd: number; units: number }

export type SpendDay = {
  day: string
  byCategory: Record<string, number>
  totalUsd: number
}

export function lastDays(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    return d.toISOString().slice(0, 10)
  })
}

export function pivotSpend(rows: readonly SpendRow[], days: readonly string[]): SpendDay[] {
  return days.map((day) => {
    const byCategory: Record<string, number> = {}
    for (const row of rows) {
      if (row.day === day) byCategory[row.category] = (byCategory[row.category] ?? 0) + row.costUsd
    }
    const totalUsd = Object.values(byCategory).reduce((sum, v) => sum + v, 0)
    return { day, byCategory, totalUsd }
  })
}

export function capUsage(spentUsd: number, capUsd: number): { fraction: number; over: boolean } {
  const fraction = capUsd > 0 ? spentUsd / capUsd : 0
  return { fraction, over: spentUsd >= capUsd }
}

const ASK_CATEGORY = 'ask'
const PIPELINE_CATEGORIES = ['llm', 'embedding', 'tts', 'render']

export function splitSpend(byCategory: Record<string, number>): {
  pipelineUsd: number
  askUsd: number
} {
  const pipelineUsd = PIPELINE_CATEGORIES.reduce((sum, c) => sum + (byCategory[c] ?? 0), 0)
  return { pipelineUsd, askUsd: byCategory[ASK_CATEGORY] ?? 0 }
}
