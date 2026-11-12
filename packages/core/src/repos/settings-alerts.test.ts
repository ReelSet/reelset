import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { shouldSendAlert } from './alerts.repo'
import { SETTINGS, parseSetting, settingEnumOptions } from './settings.repo'

const log = pino({ level: 'silent' })

describe('parseSetting', () => {
  it('falls back to the default when the row is missing', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, undefined, log)).toBe(2)
    expect(parseSetting(SETTINGS.dailyReelCap, null, log)).toBe(2)
  })

  it('uses a valid stored value', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, 50, log)).toBe(50)
    expect(parseSetting(SETTINGS.redditSubreddits, ['rust'], log)).toEqual(['rust'])
  })

  it('falls back to the default when the stored value is invalid, so a bad admin edit cannot break ingest', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, -5, log)).toBe(2)
    expect(parseSetting(SETTINGS.minItemScore, 3, log)).toBe(0.35)
    expect(parseSetting(SETTINGS.newsFeeds, ['not a url'], log)).toEqual(SETTINGS.newsFeeds.default)
  })
})

describe('model settings', () => {
  it('default to Haiku 5.5 at medium effort, matching the old env defaults', () => {
    expect(parseSetting(SETTINGS.scriptModel, undefined, log)).toBe('claude-haiku-5-5')
    expect(parseSetting(SETTINGS.scriptEffort, undefined, log)).toBe('medium')
    expect(parseSetting(SETTINGS.imageVetModel, undefined, log)).toBe('claude-haiku-5-5')
    expect(parseSetting(SETTINGS.askModel, undefined, log)).toBe('claude-haiku-5-5')
  })

  it('accepts a listed model and falls back on an unknown one', () => {
    expect(parseSetting(SETTINGS.scriptModel, 'claude-opus-5-5', log)).toBe('claude-opus-5-5')
    expect(parseSetting(SETTINGS.askModel, 'claude-3-haiku', log)).toBe('claude-haiku-5-5')
    expect(parseSetting(SETTINGS.scriptEffort, 'max', log)).toBe('medium')
  })

  it('stores under stable keys', () => {
    expect(SETTINGS.scriptModel.key).toBe('script_model')
    expect(SETTINGS.scriptEffort.key).toBe('script_effort')
    expect(SETTINGS.imageVetModel.key).toBe('image_vet_model')
    expect(SETTINGS.askModel.key).toBe('ask_model')
  })
})

describe('settingEnumOptions', () => {
  it('reads the options from enum schemas only', () => {
    expect(settingEnumOptions(SETTINGS.scriptModel)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
    expect(settingEnumOptions(SETTINGS.scriptEffort)).toEqual(['low', 'medium', 'high'])
    expect(settingEnumOptions(SETTINGS.ttsProvider)).toEqual(['edge', 'aura2', 'kokoro'])
    expect(settingEnumOptions(SETTINGS.dailyReelCap)).toBeNull()
    expect(settingEnumOptions(SETTINGS.redditSubreddits)).toBeNull()
  })
})

describe('shouldSendAlert', () => {
  const now = new Date('2026-11-09T12:00:00Z')

  it('sends when never sent before', () => {
    expect(shouldSendAlert(null, now)).toBe(true)
  })

  it('suppresses repeats inside the window and sends again after it', () => {
    expect(shouldSendAlert(new Date('2026-11-09T11:30:00Z'), now)).toBe(false)
    expect(shouldSendAlert(new Date('2026-11-09T11:00:00Z'), now)).toBe(true)
  })
})
