import {
  SETTINGS,
  errorFields,
  getSetting,
  recordSpend,
  spendTodayUsd,
  type Database,
  type Logger,
} from '@reelset/core'
import { sql } from 'kysely'
import { z } from 'zod'
import {
  FIRECRAWL_COST_USD,
  FIRECRAWL_REPEAT_DAYS,
  FIRECRAWL_SCRAPE_URL,
  FIRECRAWL_TIMEOUT_MS,
} from './config'
import type { ScrapeFallback } from './types'

const responseSchema = z.looseObject({
  success: z.boolean().nullish(),
  data: z.looseObject({ markdown: z.string().nullish() }).nullish(),
})

export type FirecrawlOptions = {
  apiKey: string
  db: Database
  log: Logger
  fetchImpl?: typeof fetch
}

/**
 * Paid last resort for pages the direct fetch could not read. Each call is recorded as 'scrape'
 * spend, the daily cap is enforced, and a URL scraped in the last few days is not paid for again.
 */
export function createFirecrawlFallback(opts: FirecrawlOptions): ScrapeFallback {
  const { apiKey, db, fetchImpl = fetch } = opts
  return {
    scrape: async (url, reason) => {
      const log = opts.log.child({ mod: 'firecrawl', url: url.slice(0, 200), reason })
      try {
        const cap = await getSetting(db, SETTINGS.scrapeDailySpendCapUsd, log)
        const spent = await spendTodayUsd(db, ['scrape'])
        if (spent + FIRECRAWL_COST_USD > cap) {
          log.warn({ spent, cap }, 'firecrawl daily cap reached, fallback skipped')
          return null
        }
        const recent = await db
          .selectFrom('spend_ledger')
          .select('id')
          .where('category', '=', 'scrape')
          .where(sql`meta->>'url'`, '=', url)
          .where('created_at', '>', sql<Date>`now() - ${`${FIRECRAWL_REPEAT_DAYS} days`}::interval`)
          .limit(1)
          .executeTakeFirst()
        if (recent) {
          log.info('url already scraped recently, fallback skipped')
          return null
        }

        const res = await fetchImpl(FIRECRAWL_SCRAPE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
          signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
        })
        if (!res.ok) {
          log.warn({ status: res.status }, 'firecrawl scrape rejected')
          return null
        }
        await recordSpend(
          db,
          { category: 'scrape', units: 1, costUsd: FIRECRAWL_COST_USD, meta: { url, reason } },
          log,
        )
        const parsed = responseSchema.safeParse(await res.json())
        const markdown = parsed.success ? (parsed.data.data?.markdown?.trim() ?? '') : ''
        log.info({ chars: markdown.length }, 'firecrawl fallback used')
        return markdown || null
      } catch (err) {
        log.warn(errorFields(err), 'firecrawl fallback failed')
        return null
      }
    },
  }
}
