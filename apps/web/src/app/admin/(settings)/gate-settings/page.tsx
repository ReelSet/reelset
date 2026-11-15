import {
  GATE_INSTRUCTIONS_MAX_CHARS,
  GATE_INSTRUCTIONS_MIN_CHARS,
  GATE_SCORE_MAX,
  GATE_SIGNALS,
  GATE_SOURCE_RULE_MODES,
  GATE_WEIGHT_MAX,
  SETTINGS,
  SOURCES,
  errorFields,
  loadGateConfig,
  settingEnumOptions,
  type Database,
  type Logger,
} from '@reelset/core'
import Link from 'next/link'
import { InstructionsCard } from '@/components/admin/gate/settings/InstructionsCard'
import { JudgeCard } from '@/components/admin/gate/settings/JudgeCard'
import { ModeCard } from '@/components/admin/gate/settings/ModeCard'
import { SourceRulesCard } from '@/components/admin/gate/settings/SourceRulesCard'
import { TuningCard } from '@/components/admin/gate/settings/TuningCard'
import { Flash, Stat, Toolbar, button } from '@/components/admin/ui'
import { gateCostMarks, gateSettingMax, isGateSettingDefault } from '@/lib/admin/gate-settings'
import { SUGGEST_MIN_LABELS } from '@/lib/admin/gate-tuning'
import { GATE_MIGRATION_FIRST, GATE_MODE_COPY, GATE_TABLE_MISSING } from '@/lib/admin/gate-view'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { thresholdSuggestion } from '@/server/admin/gate'
import { gateReviewCounts, type GateReviewCounts } from '@/server/admin/gate-queries'
import { assertAdmin } from '@/server/admin/guard'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const metadata = { title: 'Gate settings' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const PERCENT = 100
const JUDGE_SETTINGS = [
  'model',
  'effort',
  'exploreRate',
  'exampleCount',
  'maxCostUsdPerItem',
] as const

async function reviewCountsOrNull(db: Database, log: Logger): Promise<GateReviewCounts | null> {
  try {
    return await gateReviewCounts(db)
  } catch (err) {
    log.warn(errorFields(err), 'gate review counts unavailable')
    return null
  }
}

export default async function GateSettingsPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const log = routeLog('admin/gate-settings')
  const config = await loadGateConfig(db, log)
  const [suggestion, counts] = await Promise.all([
    thresholdSuggestion(db, config, log),
    reviewCountsOrNull(db, log),
  ])
  const judge = {
    model: config.model,
    effort: config.effort,
    exploreRatePercent: Math.round(config.exploreRate * PERCENT * 100) / 100,
    exampleCount: config.exampleCount,
    maxCostUsdPerItem: config.maxCostUsdPerItem,
  }
  const tuning = { threshold: config.threshold, weights: config.weights }

  return (
    <div>
      <Toolbar
        hint="The gate judges each new item before a script is written. Changes apply to the next item it judges."
        actions={
          <Link href={ADMIN_ROUTES.gate} className={button}>
            Review decisions
          </Link>
        }
      />
      <Flash value={sp.flash} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Mode" value={GATE_MODE_COPY[config.mode].label} />
        <Stat label="Threshold" value={config.threshold} />
        <Stat label="Labelled decisions" value={counts ? counts.agreed + counts.disagreed : '-'} />
        <Stat label="Awaiting review" value={counts ? counts.pending : '-'} />
      </div>
      {counts ? null : (
        <p className="mb-6 rounded-md border border-warn/50 px-4 py-3 text-xs text-warn">
          {GATE_TABLE_MISSING} {GATE_MIGRATION_FIRST} Settings can still be changed here.
        </p>
      )}
      <div className="grid gap-4">
        <ModeCard
          key={config.mode}
          saved={config.mode}
          isDefault={isGateSettingDefault('mode', config.mode)}
        />
        <TuningCard
          key={JSON.stringify(tuning)}
          {...tuning}
          signals={GATE_SIGNALS}
          scoreMax={GATE_SCORE_MAX}
          weightMax={GATE_WEIGHT_MAX}
          suggestion={suggestion}
          suggestMinLabels={SUGGEST_MIN_LABELS}
          isDefault={
            isGateSettingDefault('threshold', config.threshold) &&
            isGateSettingDefault('weights', config.weights)
          }
        />
        <SourceRulesCard
          key={JSON.stringify(config.sourceRules)}
          rules={config.sourceRules}
          sources={SOURCES}
          modes={GATE_SOURCE_RULE_MODES}
          scoreMax={GATE_SCORE_MAX}
          isDefault={isGateSettingDefault('sourceRules', config.sourceRules)}
        />
        <InstructionsCard
          key={config.instructions}
          saved={config.instructions}
          minChars={GATE_INSTRUCTIONS_MIN_CHARS}
          maxChars={GATE_INSTRUCTIONS_MAX_CHARS}
          isDefault={isGateSettingDefault('instructions', config.instructions)}
        />
        <JudgeCard
          key={JSON.stringify(judge)}
          saved={judge}
          models={settingEnumOptions(SETTINGS.gateModel) ?? [config.model]}
          efforts={settingEnumOptions(SETTINGS.gateEffort) ?? [config.effort]}
          limits={{
            exploreRatePercentMax: gateSettingMax('exploreRate') * PERCENT,
            exampleCountMax: gateSettingMax('exampleCount'),
            maxCostUsdPerItemMax: gateSettingMax('maxCostUsdPerItem'),
          }}
          costMarks={gateCostMarks(config.instructions.length)}
          isDefault={JUDGE_SETTINGS.every((name) => isGateSettingDefault(name, config[name]))}
        />
      </div>
    </div>
  )
}
