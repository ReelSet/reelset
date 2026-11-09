import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { shouldSendAlert } from './alerts.repo'
import { SETTINGS, parseSetting } from './settings.repo'

const log = pino({ level: 'silent' })

describe('parseSetting', () => {
  it('falls back to the default when the row is missing', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, undefined, log)).toBe(200)
    expect(parseSetting(SETTINGS.dailyReelCap, null, log)).toBe(200)
  })

  it('uses a valid stored value', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, 50, log)).toBe(50)
    expect(parseSetting(SETTINGS.redditSubreddits, ['rust'], log)).toEqual(['rust'])
  })

  it('falls back to the default when the stored value is invalid, so a bad admin edit cannot break ingest', () => {
    expect(parseSetting(SETTINGS.dailyReelCap, -5, log)).toBe(200)
    expect(parseSetting(SETTINGS.minItemScore, 3, log)).toBe(0.35)
    expect(parseSetting(SETTINGS.newsFeeds, ['not a url'], log)).toEqual(SETTINGS.newsFeeds.default)
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
