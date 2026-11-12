import { sql } from 'kysely'
import type { Database } from '../db/client'
import {
  DIRECTOR_SKILLS_MAX_CHARS,
  type DirectorPayload,
  type DirectorSkillKind,
} from '../domain/director'
import type { Logger } from '../lib/logger'
import { SETTINGS, getSetting } from './settings.repo'

export type DirectorSkillEntry = {
  id: string
  name: string
  kind: DirectorSkillKind
  content: string
  enabled: boolean
  sort: number
}

export type SkillInput = { name: string; kind: DirectorSkillKind; content: string }

const SKILL_COLUMNS = ['id', 'name', 'kind', 'content', 'enabled', 'sort'] as const

function toSkill(row: {
  id: string
  name: string
  kind: string
  content: string
  enabled: boolean
  sort: number
}): DirectorSkillEntry {
  return { ...row, kind: row.kind === 'example' ? 'example' : 'skill' }
}

export async function listSkills(db: Database): Promise<DirectorSkillEntry[]> {
  const rows = await db
    .selectFrom('director_skill')
    .select(SKILL_COLUMNS)
    .orderBy('sort')
    .orderBy('name')
    .execute()
  return rows.map(toSkill)
}

export async function getSkill(db: Database, id: string): Promise<DirectorSkillEntry | null> {
  const row = await db
    .selectFrom('director_skill')
    .select(SKILL_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()
  return row ? toSkill(row) : null
}

/** Inserts at the end of the list, or updates name/kind/content of the skill with this name. */
export async function upsertSkill(db: Database, input: SkillInput, log: Logger): Promise<void> {
  const next = sql<number>`coalesce((select max(sort) from director_skill), 0) + 10`
  await db
    .insertInto('director_skill')
    .values({ name: input.name, kind: input.kind, content: input.content, sort: next })
    .onConflict((oc) =>
      oc
        .column('name')
        .doUpdateSet({ kind: input.kind, content: input.content, updated_at: sql`now()` }),
    )
    .execute()
  log.info({ skill: input.name, kind: input.kind, chars: input.content.length }, 'skill upserted')
}

/** Edits one skill by id; the name may change as long as it stays unique. */
export async function updateSkill(
  db: Database,
  id: string,
  input: SkillInput,
  log: Logger,
): Promise<boolean> {
  const res = await db
    .updateTable('director_skill')
    .set({ name: input.name, kind: input.kind, content: input.content, updated_at: sql`now()` })
    .where('id', '=', id)
    .executeTakeFirst()
  log.info({ skillId: id, skill: input.name, updated: Number(res.numUpdatedRows) }, 'skill updated')
  return Number(res.numUpdatedRows) > 0
}

export async function setSkillEnabled(
  db: Database,
  id: string,
  enabled: boolean,
  log: Logger,
): Promise<boolean> {
  const res = await db
    .updateTable('director_skill')
    .set({ enabled, updated_at: sql`now()` })
    .where('id', '=', id)
    .executeTakeFirst()
  log.info({ skillId: id, enabled }, 'skill enabled flag set')
  return Number(res.numUpdatedRows) > 0
}

export async function deleteSkill(db: Database, id: string, log: Logger): Promise<boolean> {
  const res = await db.deleteFrom('director_skill').where('id', '=', id).executeTakeFirst()
  log.info({ skillId: id, deleted: Number(res.numDeletedRows) }, 'skill deleted')
  return Number(res.numDeletedRows) > 0
}

/** Rewrites sort to 10, 20, 30... in the given id order; ids not listed keep their relative order after. */
export function orderedSortValues(
  currentIds: readonly string[],
  firstIds: readonly string[],
): Map<string, number> {
  const known = new Set(currentIds)
  const head = firstIds.filter((id, i) => known.has(id) && firstIds.indexOf(id) === i)
  const headSet = new Set(head)
  const order = [...head, ...currentIds.filter((id) => !headSet.has(id))]
  return new Map(order.map((id, i) => [id, (i + 1) * 10]))
}

export async function reorderSkills(
  db: Database,
  firstIds: readonly string[],
  log: Logger,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('director_skill')
      .select('id')
      .orderBy('sort')
      .orderBy('name')
      .execute()
    const values = orderedSortValues(
      current.map((r) => r.id),
      firstIds,
    )
    for (const [id, sort] of values) {
      await trx.updateTable('director_skill').set({ sort }).where('id', '=', id).execute()
    }
  })
  log.info({ count: firstIds.length }, 'skills reordered')
}

/** Swaps a skill with its neighbour in the list; returns false at the edge or for an unknown id. */
export async function moveSkill(
  db: Database,
  id: string,
  direction: 'up' | 'down',
  log: Logger,
): Promise<boolean> {
  const ids = (await listSkills(db)).map((s) => s.id)
  const from = ids.indexOf(id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= ids.length) return false
  const next = [...ids]
  ;[next[from], next[to]] = [next[to]!, next[from]!]
  await reorderSkills(db, next, log)
  return true
}

export type SkillSelection = {
  skills: { name: string; content: string }[]
  example: string | null
  droppedNames: string[]
}

/** Enabled skills in order until one would overflow the budget; it and every later one are dropped by name. */
export function selectSkills(
  rows: readonly DirectorSkillEntry[],
  maxChars: number = DIRECTOR_SKILLS_MAX_CHARS,
): SkillSelection {
  const enabled = rows.filter((r) => r.enabled)
  const example = enabled.find((r) => r.kind === 'example')?.content ?? null
  const skills: SkillSelection['skills'] = []
  const droppedNames: string[] = []
  let used = 0
  let full = false
  for (const row of enabled.filter((r) => r.kind === 'skill')) {
    full = full || used + row.content.length > maxChars
    if (full) {
      droppedNames.push(row.name)
      continue
    }
    used += row.content.length
    skills.push({ name: row.name, content: row.content })
  }
  return { skills, example, droppedNames }
}

/** The director block of the render request, or null when the director is switched off. */
export async function loadDirectorConfig(
  db: Database,
  log: Logger,
): Promise<DirectorPayload | null> {
  if (!(await getSetting(db, SETTINGS.directorEnabled, log))) return null
  const [model, effort, maxTokens, review, rules, reviewPrompt, rows] = await Promise.all([
    getSetting(db, SETTINGS.directorModel, log),
    getSetting(db, SETTINGS.directorEffort, log),
    getSetting(db, SETTINGS.directorMaxTokens, log),
    getSetting(db, SETTINGS.directorReview, log),
    getSetting(db, SETTINGS.directorRules, log),
    getSetting(db, SETTINGS.directorReviewPrompt, log),
    listSkills(db),
  ])
  const selection = selectSkills(rows)
  if (selection.droppedNames.length > 0) {
    log.warn(
      { dropped: selection.droppedNames, limit: DIRECTOR_SKILLS_MAX_CHARS },
      'director skills over the size budget, dropping the last ones',
    )
  }
  return {
    model,
    effort,
    maxTokens,
    review,
    rules,
    reviewPrompt,
    skills: selection.skills,
    example: selection.example,
  }
}
