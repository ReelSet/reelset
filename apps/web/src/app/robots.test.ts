import { describe, expect, it } from 'vitest'
import robots from './robots'

describe('robots', () => {
  it('keeps every crawler out of filtered variants and private paths', () => {
    const { rules } = robots()
    const list = Array.isArray(rules) ? rules : [rules]
    expect(list).toHaveLength(2)
    for (const rule of list) {
      expect(rule.disallow).toEqual(
        expect.arrayContaining(['/*?*topic=', '/*?*source=', '/api/', '/admin', '/t/by/']),
      )
      expect(rule.allow).toBe('/')
    }
  })
})
