import { describe, expect, it } from 'vitest'
import { DIRECTOR_DEFAULT_RULES, SETTINGS } from '@reelset/core'
import {
  directorRunCostUsd,
  directorSettingFields,
  parseDirectorSetting,
  parseSkillForm,
  promptBudget,
} from './director'
import { settingFields } from './settings-form'
import { safeAdminPath } from './retry'

describe('director settings form', () => {
  it('lists the seven director settings and keeps them off the generic settings page', () => {
    expect(directorSettingFields().map((f) => f.def.key)).toEqual([
      'director_enabled',
      'director_model',
      'director_effort',
      'director_review',
      'director_max_tokens',
      'director_rules',
      'director_review_prompt',
    ])
    expect(settingFields().some((f) => f.def.key.startsWith('director_'))).toBe(false)
  })

  it('parses each kind and rejects out-of-range values', () => {
    expect(parseDirectorSetting('directorEnabled', 'false')).toEqual({ ok: true, value: false })
    expect(parseDirectorSetting('directorEffort', 'xhigh')).toEqual({ ok: true, value: 'xhigh' })
    expect(parseDirectorSetting('directorMaxTokens', '2048')).toEqual({ ok: true, value: 2048 })
    expect(parseDirectorSetting('directorMaxTokens', '10').ok).toBe(false)
    expect(parseDirectorSetting('directorMaxTokens', '').ok).toBe(false)
    expect(parseDirectorSetting('directorModel', 'gpt-5').ok).toBe(false)
    expect(parseDirectorSetting('directorRules', 'too short').ok).toBe(false)
    expect(parseDirectorSetting('directorRules', 'x'.repeat(20_001)).ok).toBe(false)
  })

  it('normalises line endings in prompt text and accepts the default prompt', () => {
    const parsed = parseDirectorSetting(
      'directorRules',
      DIRECTOR_DEFAULT_RULES.replace(/\n/g, '\r\n'),
    )
    expect(parsed).toEqual({ ok: true, value: SETTINGS.directorRules.default })
  })

  it('rejects unknown names and non-string values', () => {
    expect(parseDirectorSetting('dailyReelCap', '5').ok).toBe(false)
    expect(parseDirectorSetting('directorModel', null).ok).toBe(false)
  })
})

describe('parseSkillForm', () => {
  it('trims the name and keeps content', () => {
    expect(parseSkillForm({ name: '  motion ', kind: 'skill', content: 'a\r\nb' })).toEqual({
      ok: true,
      value: { name: 'motion', kind: 'skill', content: 'a\nb' },
    })
  })
  it('rejects empty, oversized and unknown input', () => {
    expect(parseSkillForm({ name: '', kind: 'skill', content: 'x' }).ok).toBe(false)
    expect(parseSkillForm({ name: 'x'.repeat(81), kind: 'skill', content: 'x' }).ok).toBe(false)
    expect(parseSkillForm({ name: 'a', kind: 'prompt', content: 'x' }).ok).toBe(false)
    expect(parseSkillForm({ name: 'a', kind: 'skill', content: '   ' }).ok).toBe(false)
    expect(parseSkillForm({ name: 'a', kind: 'skill', content: null }).ok).toBe(false)
  })
})

describe('promptBudget', () => {
  const skills = [
    { kind: 'skill', enabled: true, chars: 200_000 },
    { kind: 'skill', enabled: false, chars: 500_000 },
    { kind: 'example', enabled: true, chars: 10_000 },
    { kind: 'example', enabled: true, chars: 99_000 },
  ]
  it('counts enabled skills and only the first enabled example', () => {
    const b = promptBudget(10_000, skills)
    expect(b.skillChars).toBe(200_000)
    expect(b.totalChars).toBe(220_000)
    expect(b.tokens).toBe(55_000)
    expect(b.overLongPromptTier).toBe(false)
  })
  it('flags the long-prompt tier above 100K tokens and the skill limit above 600K chars', () => {
    expect(promptBudget(10_000, [{ kind: 'skill', enabled: true, chars: 400_000 }])).toMatchObject({
      overLongPromptTier: true,
      overSkillLimit: false,
    })
    expect(promptBudget(0, [{ kind: 'skill', enabled: true, chars: 600_001 }]).overSkillLimit).toBe(
      true,
    )
  })
})

describe('directorRunCostUsd', () => {
  const base = {
    used: true,
    scenes: 5,
    sceneErrors: 0,
    fallbackReason: null,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ms: 1,
  }
  it('prices a run with the core helper, long tier included', () => {
    const cost = directorRunCostUsd({
      ...base,
      model: 'claude-haiku-5-5',
      inputTokens: 120_000,
      outputTokens: 10_000,
    })
    expect(cost).toBeCloseTo(0.06 + 0.025, 6)
  })
  it('is null for a model outside the price table', () => {
    expect(
      directorRunCostUsd({ ...base, model: 'mystery', inputTokens: 1, outputTokens: 1 }),
    ).toBeNull()
  })
})

describe('admin redirect paths', () => {
  it('allows nested admin pages with an id query', () => {
    const path = '/admin/director/edit?id=0b5d2f3e-6a1c-4e0b-9a55-1c2d3e4f5a6b'
    expect(safeAdminPath(path)).toBe(path)
    expect(safeAdminPath('/admin/director/../x')).toBe('/admin')
  })
})
