'use server'

import { gateFormFields } from '@/lib/admin/gate-settings'
import { formDataStrings } from '@/lib/admin/moderation'
import {
  bulkAgree,
  clearDecisionLabel,
  disagreeAndMakeReel,
  labelDecision,
  makeReelAnyway,
  resetGateSetting,
  saveGateSettings,
  testGateTuning,
  type GateDryRun,
} from '@/server/admin/gate'
import { checkLink, judgeItemNow, type LinkCheck } from '@/server/admin/gate-judge'
import { assertAdmin } from '@/server/admin/guard'
import { runAdminAction, runAdminFormAction, type AdminFormState } from '@/server/admin/run'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

function review(formData: FormData) {
  return { id: formData.get('id'), reason: formData.get('reason'), note: formData.get('note') }
}

export async function labelGateDecisionAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-label', async ({ adminId, log }) =>
    labelDecision(getDb(), { ...review(formData), label: formData.get('label'), adminId }, log),
  )
}

export async function clearGateLabelAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-clear-label', async ({ log }) =>
    clearDecisionLabel(getDb(), { id: formData.get('id') }, log),
  )
}

export async function bulkAgreeGateAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-bulk-agree', async ({ adminId, log }) =>
    bulkAgree(getDb(), { ids: formDataStrings(formData, 'decisionId'), adminId }, log),
  )
}

export async function makeReelAnywayAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-make-reel', async ({ adminId, log }) =>
    makeReelAnyway(getDb(), { itemId: formData.get('itemId'), adminId }, log),
  )
}

export async function disagreeAndMakeReelAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-disagree-make-reel', async ({ adminId, log }) =>
    disagreeAndMakeReel(getDb(), { ...review(formData), adminId }, log),
  )
}

export async function saveGateSettingsAction(
  _previous: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return runAdminFormAction(formData, 'gate-save-settings', async ({ log }) =>
    saveGateSettings(getDb(), gateFormFields(formData), log),
  )
}

export async function resetGateSettingAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-reset-setting', async ({ log }) =>
    resetGateSetting(getDb(), { name: formData.get('name') }, log),
  )
}

export async function testGateTuningAction(
  _previous: GateDryRun | null,
  formData: FormData,
): Promise<GateDryRun> {
  const admin = await assertAdmin()
  const log = routeLog('admin/gate-dry-run').child({ adminId: admin.id })
  return testGateTuning(getDb(), gateFormFields(formData), log)
}

export async function judgeItemNowAction(formData: FormData): Promise<void> {
  await runAdminAction(formData, 'gate-judge-now', async ({ log }) =>
    judgeItemNow({ itemId: formData.get('itemId') }, log),
  )
}

export async function checkGateLinkAction(
  _previous: LinkCheck | null,
  formData: FormData,
): Promise<LinkCheck> {
  const admin = await assertAdmin()
  const log = routeLog('admin/gate-check-link').child({ adminId: admin.id })
  return checkLink(getDb(), formData.get('link'), log)
}
