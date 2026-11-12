import Link from 'next/link'
import {
  deleteDirectorSkillAction,
  moveDirectorSkillAction,
  toggleDirectorSkillAction,
} from '@/app/admin/actions'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { Empty, Table, button, td, th } from '@/components/admin/ui'
import { fmtKb } from '@/lib/admin/director'
import type { SkillListRow } from '@/server/admin/director'

const RETURN_TO = '/admin/director'

function IdForm({
  id,
  action,
  extra,
  children,
}: {
  id: string
  action: (formData: FormData) => Promise<void>
  extra?: Record<string, string>
  children: React.ReactNode
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={RETURN_TO} />
      {Object.entries(extra ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  )
}

function SkillRow({ skill, index, last }: { skill: SkillListRow; index: number; last: boolean }) {
  return (
    <tr className={skill.enabled ? '' : 'opacity-55'}>
      <td className={`${td} tabular-nums text-faint`}>{index + 1}</td>
      <td className={`${td} font-mono`}>{skill.name}</td>
      <td className={td}>{skill.kind}</td>
      <td className={`${td} tabular-nums`}>{fmtKb(skill.chars)}</td>
      <td className={td}>
        <IdForm
          id={skill.id}
          action={toggleDirectorSkillAction}
          extra={{ enabled: String(!skill.enabled) }}
        >
          <SubmitButton className={button} pendingLabel="...">
            {skill.enabled ? 'On' : 'Off'}
          </SubmitButton>
        </IdForm>
      </td>
      <td className={td}>
        <span className="inline-flex gap-1">
          {index > 0 && (
            <IdForm id={skill.id} action={moveDirectorSkillAction} extra={{ direction: 'up' }}>
              <SubmitButton className={button} pendingLabel="...">
                Up
              </SubmitButton>
            </IdForm>
          )}
          {!last && (
            <IdForm id={skill.id} action={moveDirectorSkillAction} extra={{ direction: 'down' }}>
              <SubmitButton className={button} pendingLabel="...">
                Down
              </SubmitButton>
            </IdForm>
          )}
        </span>
      </td>
      <td className={td}>
        <span className="inline-flex gap-1">
          <Link href={`/admin/director/edit?id=${skill.id}`} className={button}>
            Edit
          </Link>
          <IdForm id={skill.id} action={deleteDirectorSkillAction}>
            <SubmitButton
              className={button}
              pendingLabel="Deleting"
              confirm={`Delete ${skill.name}? This cannot be undone.`}
            >
              Delete
            </SubmitButton>
          </IdForm>
        </span>
      </td>
    </tr>
  )
}

export function SkillsTable({ skills }: { skills: SkillListRow[] }) {
  if (skills.length === 0)
    return <Empty>No skills yet. Add one below or run the seed script.</Empty>
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>#</th>
          <th className={th}>Name</th>
          <th className={th}>Kind</th>
          <th className={th}>Size</th>
          <th className={th}>Enabled</th>
          <th className={th}>Order</th>
          <th className={th}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((skill, i) => (
          <SkillRow key={skill.id} skill={skill} index={i} last={i === skills.length - 1} />
        ))}
      </tbody>
    </Table>
  )
}
