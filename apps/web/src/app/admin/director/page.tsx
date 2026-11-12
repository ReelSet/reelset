import { DIRECTOR_LONG_PROMPT_TOKENS, DIRECTOR_SKILLS_MAX_CHARS, SETTINGS } from '@reelset/core'
import { createDirectorSkillAction } from '@/app/admin/actions'
import { DirectorSettingForm } from '@/components/admin/director/DirectorSettings'
import { RecentRuns } from '@/components/admin/director/RecentRuns'
import { SkillForm } from '@/components/admin/director/SkillForm'
import { SkillsTable } from '@/components/admin/director/SkillsTable'
import { Flash, PageTitle, Section, Stat } from '@/components/admin/ui'
import { directorSettingFields, fmtKb, fmtTokens, promptBudget } from '@/lib/admin/director'
import { assertAdmin } from '@/server/admin/guard'
import { directorSettingValues, recentDirectorRuns, skillList } from '@/server/admin/director'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

export const metadata = { title: 'Director' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

const asText = (value: unknown): string => String(value ?? '')

export default async function DirectorPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const db = getDb()
  const log = routeLog('admin/director')
  const [values, skills, runs] = await Promise.all([
    directorSettingValues(db, log),
    skillList(db),
    recentDirectorRuns(db),
  ])
  const rules = asText(values.get('directorRules'))
  const budget = promptBudget(rules.length, skills)

  return (
    <div>
      <PageTitle
        title="Director"
        hint="Claude writes each reel's illustration code on a Skia canvas, reviews the rendered frames once, then the box renders. Changes apply to the next render."
      />
      <Flash value={sp.flash} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Enabled skill text"
          value={fmtKb(budget.skillChars)}
          tone={budget.overSkillLimit ? 'danger' : undefined}
        />
        <Stat label="Prompt size" value={fmtKb(budget.totalChars)} />
        <Stat
          label="Approx tokens"
          value={fmtTokens(budget.tokens)}
          tone={budget.overLongPromptTier ? 'warn' : undefined}
        />
        <Stat label="Director" value={values.get('directorEnabled') ? 'on' : 'off'} />
      </div>
      {budget.overLongPromptTier && (
        <p className="mb-6 rounded-md border border-warn/50 px-4 py-3 text-xs text-warn">
          The prompt is likely over {fmtTokens(DIRECTOR_LONG_PROMPT_TOKENS)} tokens (characters /
          4), where Haiku 5.5 bills 5x per token. Disable a skill to drop below it.
        </p>
      )}
      {budget.overSkillLimit && (
        <p className="mb-6 rounded-md border border-danger/50 px-4 py-3 text-xs text-danger">
          Enabled skills exceed {fmtKb(DIRECTOR_SKILLS_MAX_CHARS)}. The last skills in order are
          dropped from each render.
        </p>
      )}

      <Section title="Settings">
        <div className="grid gap-4">
          {directorSettingFields().map((field) => {
            const value = values.get(field.name)
            return (
              <DirectorSettingForm
                key={field.name}
                field={field}
                value={asText(value)}
                isDefault={value === SETTINGS[field.name].default}
              />
            )
          })}
        </div>
      </Section>

      <Section title="Skills and examples">
        <p className="mb-3 text-xs text-faint">
          Enabled skills are sent in this order after the rules. The first enabled example is sent
          as the sample scene script.
        </p>
        <SkillsTable skills={skills} />
      </Section>

      <Section title="Add skill">
        <SkillForm
          action={createDirectorSkillAction}
          returnTo="/admin/director"
          submitLabel="Add skill"
        />
      </Section>

      <Section title="Recent director runs">
        <RecentRuns runs={runs} />
      </Section>
    </div>
  )
}
