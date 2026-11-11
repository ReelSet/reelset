import { formatSettingInput, settingFields } from '@/lib/admin/settings-form'
import { Flash, PageTitle, Section, Table, buttonPrimary, td, th } from '@/components/admin/ui'
import { SettingValueInput } from '@/components/admin/SettingValueInput'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { saveSettingAction } from '@/app/admin/actions'
import { assertAdmin } from '@/server/admin/guard'
import { currentSettings } from '@/server/admin/queries'
import { getDb } from '@/server/db'
import { routeLog } from '@/server/logger'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function SettingsPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const values = await currentSettings(getDb(), routeLog('admin/settings'))

  return (
    <div>
      <PageTitle
        title="Settings"
        hint="Runtime knobs read by ingest, render and the web app. Changes apply on the next run."
      />
      <Flash value={sp.flash} />
      <Section title="All settings">
        <Table>
          <thead>
            <tr>
              <th className={th}>Key</th>
              <th className={th}>Value</th>
              <th className={th}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {settingFields().map((field) => {
              const text = formatSettingInput(field.kind, values.get(field.def.key))
              return (
                <tr key={field.def.key}>
                  <td className={`${td} font-mono`}>{field.def.key}</td>
                  <td className={td}>
                    <form action={saveSettingAction} className="flex items-start gap-2">
                      <input type="hidden" name="name" value={field.name} />
                      <input type="hidden" name="returnTo" value="/admin/settings" />
                      <SettingValueInput field={field} text={text} />
                      <SubmitButton className={buttonPrimary} pendingLabel="Saving">
                        Save
                      </SubmitButton>
                    </form>
                  </td>
                  <td className={`${td} text-faint`}>{field.hint}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </Section>
    </div>
  )
}
