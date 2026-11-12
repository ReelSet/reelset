import { describe, expect, it } from 'vitest'
import { orderedSortValues, selectSkills, type DirectorSkillEntry } from './director.repo'

const skill = (
  name: string,
  content: string,
  over: Partial<DirectorSkillEntry> = {},
): DirectorSkillEntry => ({
  id: name,
  name,
  kind: 'skill',
  content,
  enabled: true,
  sort: 0,
  ...over,
})

describe('selectSkills', () => {
  it('keeps enabled skills in order and picks the first enabled example', () => {
    const out = selectSkills([
      skill('a', 'AAA'),
      skill('off', 'zzz', { enabled: false }),
      skill('ex1', 'scene one', { kind: 'example' }),
      skill('ex2', 'scene two', { kind: 'example' }),
      skill('b', 'BBB'),
    ])
    expect(out.skills.map((s) => s.name)).toEqual(['a', 'b'])
    expect(out.example).toBe('scene one')
    expect(out.droppedNames).toEqual([])
  })
  it('has no example when none is enabled', () => {
    expect(selectSkills([skill('ex', 'x', { kind: 'example', enabled: false })]).example).toBeNull()
  })
  it('stops at the first skill that overflows and names every dropped one', () => {
    const out = selectSkills([skill('a', '12345'), skill('big', '123456'), skill('tiny', '1')], 10)
    expect(out.skills.map((s) => s.name)).toEqual(['a'])
    expect(out.droppedNames).toEqual(['big', 'tiny'])
  })
  it('allows content that exactly fills the budget', () => {
    const out = selectSkills([skill('a', '12345'), skill('b', '12345')], 10)
    expect(out.droppedNames).toEqual([])
  })
})

describe('orderedSortValues', () => {
  it('numbers by the new order in steps of ten', () => {
    const m = orderedSortValues(['a', 'b', 'c'], ['b', 'a', 'c'])
    expect([...m]).toEqual([
      ['b', 10],
      ['a', 20],
      ['c', 30],
    ])
  })
  it('ignores unknown and duplicate ids and appends unlisted ones', () => {
    const m = orderedSortValues(['a', 'b', 'c'], ['c', 'x', 'c'])
    expect([...m.keys()]).toEqual(['c', 'a', 'b'])
  })
})
