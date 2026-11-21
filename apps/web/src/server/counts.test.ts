import { describe, expect, it } from 'vitest'
import { pino } from 'pino'
import { scriptedDb, sqlHas } from './admin/scripted-db'
import { loadCountRules } from './counts'

const log = pino({ level: 'silent' })

describe('loadCountRules', () => {
  it('reads all six settings in one query and fills defaults', async () => {
    const { db, queries } = scriptedDb(() => [
      { key: 'show_view_count', value: true },
      { key: 'view_count_threshold', value: 5 },
      { key: 'like_count_threshold', value: 'not a number' },
    ])
    const rules = await loadCountRules(db, log)
    expect(queries).toHaveLength(1)
    expect(sqlHas(queries[0]!, 'from "app_setting"')).toBe(true)
    expect(queries[0]!.parameters).toHaveLength(6)
    expect(rules.views).toEqual({ show: true, min: 5 })
    expect(rules.likes.min).toBeTypeOf('number')
    expect(rules.saves.show).toBeTypeOf('boolean')
  })
})
