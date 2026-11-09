export type SpendGate = 'ok' | 'spend_capped'

export type SpendGateInput = {
  spentTodayUsd: number
  dailyCapUsd: number
}

export function decideSpendGate(input: SpendGateInput): SpendGate {
  return input.spentTodayUsd >= input.dailyCapUsd ? 'spend_capped' : 'ok'
}

export function isOverHourlyLimit(recentAsks: number, hourlyLimit: number): boolean {
  return recentAsks >= hourlyLimit
}
