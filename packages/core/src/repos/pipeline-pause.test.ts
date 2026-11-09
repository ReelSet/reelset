import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { pipelinePauseSchema, SETTINGS, parseSetting } from './settings.repo'
import { ALERT_KEYS } from './alerts.repo'

const log = pino({ level: 'silent' })

describe('pipeline pause setting', () => {
  it('defaults to not paused and validates the stored shape', () => {
    expect(parseSetting(SETTINGS.pipelinePaused, undefined, log)).toBeNull()
    expect(parseSetting(SETTINGS.pipelinePaused, null, log)).toBeNull()
    const pause = {
      reason: 'Gemini HTTP 402',
      since: '2026-11-09T00:00:00Z',
      until: '2026-11-09T00:15:00Z',
    }
    expect(pipelinePauseSchema.parse(pause)).toEqual(pause)
    expect(parseSetting(SETTINGS.pipelinePaused, { reason: 1 }, log)).toBeNull()
  })
  it('registers the quota alert key', () => {
    expect(ALERT_KEYS).toContain('llm_quota_exhausted')
  })
})
