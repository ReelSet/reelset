import {
  SETTINGS,
  deleteSkill,
  moveSkill,
  parseDirectorMeta,
  setSetting,
  setSkillEnabled,
  updateSkill,
  upsertSkill,
  getSetting,
  errorFields,
  type Database,
  type DirectorMeta,
  type Logger,
  type SettingDef,
} from '@reelset/core'
import { sql } from 'kysely'
import {
  directorSettingFields,
  isDirectorSettingName,
  parseDirectorSetting,
  parseSkillForm,
  type DirectorSettingName,
} from '@/lib/admin/director'
import type { CommandResult } from '@/server/admin/commands'

export const DIRECTOR_RUNS_LIMIT = 30
const UNIQUE_VIOLATION = '23505'

export async function saveDirectorSetting(
  db: Database,
  input: { name: unknown; raw: unknown },
  log: Logger,
): Promise<CommandResult> {
  const parsed = parseDirectorSetting(input.name, input.raw)
  if (!parsed.ok) return { ok: false, message: parsed.error }
  const def = SETTINGS[input.name as DirectorSettingName] as SettingDef<unknown>
  await setSetting(db, def, parsed.value, log.child({ fn: 'saveDirectorSetting' }))
  return { ok: true, message: `${def.key} saved` }
}

export async function resetDirectorSetting(
  db: Database,
  input: { name: unknown },
  log: Logger,
): Promise<CommandResult> {
  if (!isDirectorSettingName(input.name)) return { ok: false, message: 'Unknown director setting' }
  const def = SETTINGS[input.name] as SettingDef<unknown>
  await setSetting(db, def, def.default, log.child({ fn: 'resetDirectorSetting' }))
  return { ok: true, message: `${def.key} reset to default` }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION
}

type SkillFields = { name: unknown; kind: unknown; content: unknown }

export async function createDirectorSkill(
  db: Database,
  input: SkillFields,
  log: Logger,
): Promise<CommandResult> {
  const parsed = parseSkillForm(input)
  if (!parsed.ok) return { ok: false, message: parsed.error }
  await upsertSkill(db, parsed.value, log)
  return { ok: true, message: `${parsed.value.name} saved` }
}

export async function saveDirectorSkill(
  db: Database,
  input: SkillFields & { id: string },
  log: Logger,
): Promise<CommandResult> {
  const parsed = parseSkillForm(input)
  if (!parsed.ok) return { ok: false, message: parsed.error }
  try {
    const found = await updateSkill(db, input.id, parsed.value, log)
    return found
      ? { ok: true, message: `${parsed.value.name} saved` }
      : { ok: false, message: 'Skill not found' }
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    log.warn({ skillId: input.id, ...errorFields(err) }, 'skill rename rejected: name taken')
    return { ok: false, message: `Another skill is already named ${parsed.value.name}` }
  }
}

export async function toggleDirectorSkill(
  db: Database,
  input: { id: string; enabled: boolean },
  log: Logger,
): Promise<CommandResult> {
  const found = await setSkillEnabled(db, input.id, input.enabled, log)
  if (!found) return { ok: false, message: 'Skill not found' }
  return { ok: true, message: input.enabled ? 'Skill enabled' : 'Skill disabled' }
}

export async function moveDirectorSkill(
  db: Database,
  input: { id: string; direction: 'up' | 'down' },
  log: Logger,
): Promise<CommandResult> {
  const moved = await moveSkill(db, input.id, input.direction, log)
  return moved
    ? { ok: true, message: `Moved ${input.direction}` }
    : { ok: false, message: 'Cannot move further that way' }
}

export async function removeDirectorSkill(
  db: Database,
  input: { id: string },
  log: Logger,
): Promise<CommandResult> {
  const deleted = await deleteSkill(db, input.id, log)
  return deleted
    ? { ok: true, message: 'Skill deleted' }
    : { ok: false, message: 'Skill not found' }
}

export type SkillListRow = {
  id: string
  name: string
  kind: string
  enabled: boolean
  sort: number
  chars: number
}

/** Skill rows without their content, so the page never loads hundreds of KB per view. */
export async function skillList(db: Database): Promise<SkillListRow[]> {
  const rows = await db
    .selectFrom('director_skill')
    .select([
      'id',
      'name',
      'kind',
      'enabled',
      'sort',
      sql<number>`char_length(content)`.as('chars'),
    ])
    .orderBy('sort')
    .orderBy('name')
    .execute()
  return rows.map((r) => ({ ...r, chars: Number(r.chars) }))
}

export async function directorSettingValues(db: Database, log: Logger) {
  const entries = await Promise.all(
    directorSettingFields().map(async (f) => [f.name, await getSetting(db, f.def, log)] as const),
  )
  return new Map<DirectorSettingName, unknown>(entries)
}

export type DirectorRun = {
  renderId: string
  itemId: string
  title: string
  at: Date | null
  renderMs: number | null
  director: DirectorMeta
}

export async function recentDirectorRuns(
  db: Database,
  limit: number = DIRECTOR_RUNS_LIMIT,
): Promise<DirectorRun[]> {
  const rows = await db
    .selectFrom('render')
    .innerJoin('item', 'item.id', 'render.item_id')
    .select([
      'render.id',
      'render.item_id',
      'item.title',
      'render.finished_at',
      'render.created_at',
      'render.render_ms',
      'render.director',
    ])
    .where('render.director', 'is not', null)
    .orderBy(sql`render.finished_at desc nulls last`)
    .orderBy('render.created_at', 'desc')
    .limit(limit)
    .execute()
  return rows.flatMap((r) => {
    const director = parseDirectorMeta(r.director)
    if (!director) return []
    return [
      {
        renderId: r.id,
        itemId: r.item_id,
        title: r.title,
        at: new Date(r.finished_at ?? r.created_at),
        renderMs: r.render_ms,
        director,
      },
    ]
  })
}
