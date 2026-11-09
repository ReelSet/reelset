import { SETTINGS, getSetting, type Database, type Logger } from '@reelset/core'
import type { IngestSettings } from '../types'

export async function loadIngestSettings(db: Database, log: Logger): Promise<IngestSettings> {
  return {
    redditSubreddits: await getSetting(db, SETTINGS.redditSubreddits, log),
    youtubeSearchQueries: await getSetting(db, SETTINGS.youtubeSearchQueries, log),
    youtubeMaxAgeDays: await getSetting(db, SETTINGS.youtubeMaxAgeDays, log),
    youtubeResultsPerQuery: await getSetting(db, SETTINGS.youtubeResultsPerQuery, log),
    newsFeeds: await getSetting(db, SETTINGS.newsFeeds, log),
  }
}
