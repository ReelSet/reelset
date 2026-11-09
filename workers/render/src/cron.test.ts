import { renderKey, type AlertInput } from '@reelset/core'
import { describe, expect, it } from 'vitest'
import {
  applyRetention,
  checkAlerts,
  cleanOrphans,
  failStuck,
  runMaintenance,
  upgradeTemplates,
  type MaintenanceDeps,
} from './cron'
import type { ExpiredRender, MaintenanceStore } from './store'
import { silentLog } from './testing'
import { TEMPLATE_VERSION, UPGRADE_BATCH_SIZE, UPGRADE_IN_FLIGHT_TARGET } from './constants'

const now = new Date('2026-11-09T12:00:00Z')
const old = new Date('2026-11-07T00:00:00Z')

function setup(overrides: Partial<MaintenanceStore> = {}, listPage?: unknown) {
  const calls: Record<string, unknown[]> = {}
  const track = (name: string, arg: unknown) => (calls[name] ??= []).push(arg)
  const alerts: AlertInput[] = []
  const store: MaintenanceStore = {
    failStuckRenders: async (cutoff) => {
      track('stuck', cutoff)
      return [{ renderId: 'r1', itemId: 'i1' }]
    },
    doneKeys: async () => new Set(['reels/a/1.mp4']),
    expiredRenders: async (cutoff, limit) => {
      track('expired', [cutoff, limit])
      return []
    },
    clearRenderKeys: async (ids) => {
      track('clear', ids)
    },
    renderCountsSince: async () => ({ total: 0, failed: 0 }),
    deadLetteredSince: async () => 0,
    renderedForUpgrade: async () => [],
    existingRenderKeys: async () => new Set(),
    activeRenderCount: async () => 0,
    pendingNewItemCount: async () => 0,
    getUpgradeSent: async () => [],
    setUpgradeSent: async () => {},
    getOrphanCursor: async () => 'c0',
    setOrphanCursor: async (c) => {
      track('cursor', c)
    },
    ...overrides,
  }
  const media = {
    list: async (options: unknown) => {
      track('list', options)
      return (
        listPage ?? {
          objects: [
            { key: 'reels/a/1.mp4', uploaded: old },
            { key: 'reels/b/2.mp4', uploaded: old },
          ],
          truncated: false,
        }
      )
    },
    delete: async (keys: unknown) => {
      track('delete', keys)
    },
  }
  const deps: MaintenanceDeps = {
    store,
    media: media as unknown as MaintenanceDeps['media'],
    alert: async (input) => {
      alerts.push(input)
    },
    retentionDays: async () => 30,
    log: silentLog,
    now: () => now,
  }
  return { deps, calls, alerts }
}

describe('maintenance', () => {
  it('fails renders stuck longer than 20 minutes', async () => {
    const { deps, calls } = setup()
    expect(await failStuck(deps, now, silentLog)).toBe(1)
    expect((calls.stuck![0] as Date).toISOString()).toBe('2026-11-09T11:40:00.000Z')
  })

  it('deletes orphaned objects and resets the scan cursor when the listing ends', async () => {
    const { deps, calls } = setup()
    expect(await cleanOrphans(deps, now, silentLog)).toBe(1)
    expect(calls.delete).toEqual([['reels/b/2.mp4']])
    expect(calls.list![0]).toMatchObject({ prefix: 'reels/', cursor: 'c0' })
    expect(calls.cursor).toEqual([null])
  })

  it('stores the cursor while the listing is truncated and deletes nothing when there are no orphans', async () => {
    const page = {
      objects: [{ key: 'reels/a/1.mp4', uploaded: old }],
      truncated: true,
      cursor: 'c1',
    }
    const { deps, calls } = setup({}, page)
    expect(await cleanOrphans(deps, now, silentLog)).toBe(0)
    expect(calls.delete).toBeUndefined()
    expect(calls.cursor).toEqual(['c1'])
  })

  it('applies retention by deleting objects then clearing keys', async () => {
    const expired: ExpiredRender[] = [
      { id: 'r1', videoKey: 'reels/a/1.mp4', posterKey: 'reels/a/1.jpg' },
      { id: 'r2', videoKey: 'reels/b/2.mp4', posterKey: null },
    ]
    const { deps, calls } = setup({
      expiredRenders: async (cutoff) => {
        expect(cutoff.toISOString()).toBe('2026-10-10T12:00:00.000Z')
        return expired
      },
    })
    expect(await applyRetention(deps, now, silentLog)).toBe(2)
    expect(calls.delete).toEqual([['reels/a/1.mp4', 'reels/a/1.jpg', 'reels/b/2.mp4']])
    expect(calls.clear).toEqual([['r1', 'r2']])
  })

  it('does nothing when no renders are past retention', async () => {
    const { deps, calls } = setup()
    expect(await applyRetention(deps, now, silentLog)).toBe(0)
    expect(calls.delete).toBeUndefined()
  })

  it('alerts on high failure rate and dead letters', async () => {
    const { deps, alerts } = setup({
      renderCountsSince: async () => ({ total: 10, failed: 3 }),
      deadLetteredSince: async () => 4,
    })
    await checkAlerts(deps, now, silentLog)
    expect(alerts.map((a) => a.key)).toEqual(['render_failure_rate_high', 'dead_letter_growing'])
    expect(alerts[0]?.fields).toEqual({ total: 10, failed: 3 })
  })

  it('stays quiet when healthy', async () => {
    const { deps, alerts } = setup({ renderCountsSince: async () => ({ total: 10, failed: 2 }) })
    await checkAlerts(deps, now, silentLog)
    expect(alerts).toEqual([])
  })

  it('keeps running later steps when one step throws', async () => {
    const { deps, alerts } = setup({
      failStuckRenders: async () => {
        throw new Error('db down')
      },
      renderCountsSince: async () => ({ total: 5, failed: 5 }),
    })
    await runMaintenance(deps)
    expect(alerts.map((a) => a.key)).toContain('render_failure_rate_high')
  })
})

describe('template upgrade sweep', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    contentHash: `h${i}`,
    promptVersion: 'p1',
  }))
  const keyOf = (c: (typeof candidates)[number]) =>
    renderKey({
      itemId: c.id,
      contentHash: c.contentHash,
      promptVersion: c.promptVersion,
      templateVersion: TEMPLATE_VERSION,
      voice: 'v',
    })

  function withUpgrade(overrides: Partial<MaintenanceStore> = {}) {
    const sent: string[][] = []
    const { deps } = setup({ renderedForUpgrade: async () => candidates, ...overrides })
    deps.upgrade = { voice: 'v', send: async (ids) => void sent.push(ids) }
    return { deps, sent }
  }

  it('queues a bounded batch of items without a current-template render', async () => {
    const { deps, sent } = withUpgrade()
    expect(await upgradeTemplates(deps, silentLog)).toBe(UPGRADE_BATCH_SIZE)
    expect(sent).toEqual([candidates.slice(0, UPGRADE_BATCH_SIZE).map((c) => c.id)])
  })

  it('skips items that already have a render row for the current key', async () => {
    const done = new Set([await keyOf(candidates[0]!), await keyOf(candidates[1]!)])
    const { deps, sent } = withUpgrade({
      existingRenderKeys: async (keys) => new Set(keys.filter((k) => done.has(k))),
    })
    await upgradeTemplates(deps, silentLog)
    expect(sent[0]).toEqual(candidates.slice(2, 2 + UPGRADE_BATCH_SIZE).map((c) => c.id))
  })

  it('tops up only the free slots below the in-flight target', async () => {
    const { deps, sent } = withUpgrade({ activeRenderCount: async () => 2 })
    expect(await upgradeTemplates(deps, silentLog)).toBe(UPGRADE_IN_FLIGHT_TARGET - 2)
    expect(sent[0]).toHaveLength(UPGRADE_IN_FLIGHT_TARGET - 2)
  })

  it('counts new-item backlog and recently sent upgrades before adding more', async () => {
    const recent = candidates.slice(0, 2).map((c) => ({ id: c.id, at: now.getTime() - 60_000 }))
    const saved: unknown[] = []
    const { deps, sent } = withUpgrade({
      pendingNewItemCount: async () => 1,
      getUpgradeSent: async () => recent,
      setUpgradeSent: async (s) => void saved.push(s),
    })
    expect(await upgradeTemplates(deps, silentLog, now)).toBe(UPGRADE_IN_FLIGHT_TARGET - 3)
    expect(sent[0]).toEqual(candidates.slice(2, 2 + UPGRADE_IN_FLIGHT_TARGET - 3).map((c) => c.id))
    expect(saved[0]).toHaveLength(2 + UPGRADE_IN_FLIGHT_TARGET - 3)
  })

  it('ignores sent entries older than the pending window', async () => {
    const old = candidates.slice(0, 3).map((c) => ({ id: c.id, at: now.getTime() - 3_600_000 }))
    const { deps, sent } = withUpgrade({ getUpgradeSent: async () => old })
    await upgradeTemplates(deps, silentLog, now)
    expect(sent[0]).toEqual(candidates.slice(0, UPGRADE_BATCH_SIZE).map((c) => c.id))
  })

  it('does nothing while a render is in flight, when up to date, or when not configured', async () => {
    const busy = withUpgrade({ activeRenderCount: async () => UPGRADE_IN_FLIGHT_TARGET })
    expect(await upgradeTemplates(busy.deps, silentLog)).toBe(0)
    const current = withUpgrade({ existingRenderKeys: async (keys) => new Set(keys) })
    expect(await upgradeTemplates(current.deps, silentLog)).toBe(0)
    expect(busy.sent.concat(current.sent)).toEqual([])
    const { deps } = setup({ renderedForUpgrade: async () => candidates })
    expect(await upgradeTemplates(deps, silentLog)).toBe(0)
  })
})
