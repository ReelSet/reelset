import { beforeEach, describe, expect, it, vi } from 'vitest'

const assertAdmin = vi.fn()
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
const getDb = vi.fn(() => ({ fake: 'db' }))
const commands = {
  bulkAgree: vi.fn(),
  clearDecisionLabel: vi.fn(),
  disagreeAndMakeReel: vi.fn(),
  labelDecision: vi.fn(),
  makeReelAnyway: vi.fn(),
  resetGateSetting: vi.fn(),
  saveGateSettings: vi.fn(),
  testGateTuning: vi.fn(),
  thresholdSuggestion: vi.fn(),
}
const judging = { judgeItemNow: vi.fn(), checkLink: vi.fn() }
const loadGateQueue = vi.fn()
const gateReviewCounts = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/server/admin/guard', () => ({ assertAdmin }))
vi.mock('@/server/db', () => ({ getDb }))
vi.mock('@/server/logger', () => {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => quiet }
  return { routeLog: () => quiet, log: quiet }
})
vi.mock('@/server/timezone', () => ({ viewerTimeZone: async () => 'UTC' }))
vi.mock('@/server/admin/gate', () => commands)
vi.mock('@/server/admin/gate-judge', () => judging)
vi.mock('@/server/admin/gate-queries', () => ({ loadGateQueue, gateReviewCounts }))

const actions = await import('@/app/admin/(pipeline)/gate/actions')
const { default: GatePage } = await import('@/app/admin/(pipeline)/gate/page')
const { default: GateSettingsPage } = await import('@/app/admin/(settings)/gate-settings/page')

const ADMIN = { id: 'admin-1' }
const DENIED = new Error('NOT_FOUND')

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of [value].flat()) data.append(name, entry)
  }
  return data
}

const FLASH_ACTIONS = [
  ['labelGateDecisionAction', 'labelDecision'],
  ['clearGateLabelAction', 'clearDecisionLabel'],
  ['bulkAgreeGateAction', 'bulkAgree'],
  ['makeReelAnywayAction', 'makeReelAnyway'],
  ['disagreeAndMakeReelAction', 'disagreeAndMakeReel'],
  ['resetGateSettingAction', 'resetGateSetting'],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  assertAdmin.mockResolvedValue(ADMIN)
  for (const command of Object.values(commands)) {
    command.mockResolvedValue({ ok: true, message: 'done' })
  }
})

describe('gate actions: admin guard', () => {
  it('covers every exported action in this test', () => {
    const tested = [
      ...FLASH_ACTIONS.map(([action]) => action),
      'saveGateSettingsAction',
      'testGateTuningAction',
      'judgeItemNowAction',
      'checkGateLinkAction',
    ]
    expect(Object.keys(actions).sort()).toEqual(tested.sort())
  })

  it.each(FLASH_ACTIONS)('%s runs nothing for a non-admin', async (action, command) => {
    assertAdmin.mockRejectedValue(DENIED)
    await expect(actions[action](form({ returnTo: '/admin/gate' }))).rejects.toThrow('NOT_FOUND')
    expect(commands[command]).not.toHaveBeenCalled()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('saveGateSettingsAction and testGateTuningAction run nothing for a non-admin', async () => {
    assertAdmin.mockRejectedValue(DENIED)
    await expect(actions.saveGateSettingsAction(null, form({ mode: 'live' }))).rejects.toThrow(
      'NOT_FOUND',
    )
    await expect(actions.testGateTuningAction(null, form({}))).rejects.toThrow('NOT_FOUND')
    expect(commands.saveGateSettings).not.toHaveBeenCalled()
    expect(commands.testGateTuning).not.toHaveBeenCalled()
  })
})

describe('judge on demand: guard and wiring', () => {
  it('runs nothing for a non-admin', async () => {
    assertAdmin.mockRejectedValue(DENIED)
    await expect(actions.judgeItemNowAction(form({ itemId: 'i1' }))).rejects.toThrow('NOT_FOUND')
    await expect(actions.checkGateLinkAction(null, form({ link: 'x' }))).rejects.toThrow(
      'NOT_FOUND',
    )
    expect(judging.judgeItemNow).not.toHaveBeenCalled()
    expect(judging.checkLink).not.toHaveBeenCalled()
  })

  it('judges the posted item and flashes the result', async () => {
    judging.judgeItemNow.mockResolvedValue({ ok: true, message: 'Gate says Reel' })
    await expect(
      actions.judgeItemNowAction(form({ itemId: 'i1', returnTo: '/admin/items' })),
    ).rejects.toThrow('REDIRECT:/admin/items?flash=ok%3AGate+says+Reel')
    expect(judging.judgeItemNow).toHaveBeenCalledWith({ itemId: 'i1' }, expect.anything())
  })

  it('returns the link check result to the form', async () => {
    const result = { kind: 'not_found', message: 'This source is not in reelset yet.' }
    judging.checkLink.mockResolvedValue(result)
    const link = 'https://example.com/a'
    expect(await actions.checkGateLinkAction(null, form({ link }))).toBe(result)
    expect(judging.checkLink).toHaveBeenCalledWith({ fake: 'db' }, link, expect.anything())
  })
})

describe('gate actions: wiring', () => {
  it('passes the admin and the form fields to the label command and flashes the result', async () => {
    const data = form({
      id: 'd1',
      label: 'disagree',
      reason: 'too_niche',
      note: 'n',
      returnTo: '/admin/gate?review=all',
    })
    await expect(actions.labelGateDecisionAction(data)).rejects.toThrow(
      'REDIRECT:/admin/gate?review=all&flash=ok%3Adone',
    )
    expect(commands.labelDecision).toHaveBeenCalledWith(
      { fake: 'db' },
      { id: 'd1', label: 'disagree', reason: 'too_niche', note: 'n', adminId: 'admin-1' },
      expect.anything(),
    )
  })

  it('sends every ticked decision to the bulk agree command', async () => {
    const data = form({ decisionId: ['d1', 'd2'], returnTo: '/admin/gate' })
    await expect(actions.bulkAgreeGateAction(data)).rejects.toThrow('REDIRECT')
    expect(commands.bulkAgree).toHaveBeenCalledWith(
      { fake: 'db' },
      { ids: ['d1', 'd2'], adminId: 'admin-1' },
      expect.anything(),
    )
  })

  it('overrides as the signed-in admin', async () => {
    await expect(
      actions.makeReelAnywayAction(form({ itemId: 'i1', returnTo: '/admin/gate' })),
    ).rejects.toThrow('REDIRECT')
    expect(commands.makeReelAnyway).toHaveBeenCalledWith(
      { fake: 'db' },
      { itemId: 'i1', adminId: 'admin-1' },
      expect.anything(),
    )
  })

  it('returns a settings validation error to the form instead of redirecting', async () => {
    commands.saveGateSettings.mockResolvedValue({ ok: false, message: 'gate_threshold: too big' })
    const state = await actions.saveGateSettingsAction(
      null,
      form({ threshold: '500', returnTo: '/admin/gate-settings' }),
    )
    expect(state).toEqual({ ok: false, message: 'gate_threshold: too big' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('redirects with a toast after a successful settings save', async () => {
    await expect(
      actions.saveGateSettingsAction(
        null,
        form({ mode: 'shadow', returnTo: '/admin/gate-settings' }),
      ),
    ).rejects.toThrow('REDIRECT:/admin/gate-settings?flash=ok%3Adone')
    expect(commands.saveGateSettings).toHaveBeenCalledWith(
      { fake: 'db' },
      { mode: 'shadow', returnTo: '/admin/gate-settings' },
      expect.anything(),
    )
  })

  it('contains a command that throws', async () => {
    commands.saveGateSettings.mockRejectedValue(new Error('db down'))
    const state = await actions.saveGateSettingsAction(null, form({ mode: 'live' }))
    expect(state).toEqual({ ok: false, message: 'Action failed, see server logs' })
  })

  it('returns the dry run result as is', async () => {
    const result = { ok: true, result: { sample: 0 }, suggestion: null, threshold: 60 }
    commands.testGateTuning.mockResolvedValue(result)
    expect(await actions.testGateTuningAction(null, form({ threshold: '60' }))).toBe(result)
  })
})

describe('gate pages: admin guard', () => {
  const props = { searchParams: Promise.resolve({}) }

  it('the review page loads nothing for a non-admin', async () => {
    assertAdmin.mockRejectedValue(DENIED)
    await expect(GatePage(props)).rejects.toThrow('NOT_FOUND')
    expect(getDb).not.toHaveBeenCalled()
    expect(loadGateQueue).not.toHaveBeenCalled()
  })

  it('the settings page loads nothing for a non-admin', async () => {
    assertAdmin.mockRejectedValue(DENIED)
    await expect(GateSettingsPage(props)).rejects.toThrow('NOT_FOUND')
    expect(getDb).not.toHaveBeenCalled()
    expect(gateReviewCounts).not.toHaveBeenCalled()
  })
})
