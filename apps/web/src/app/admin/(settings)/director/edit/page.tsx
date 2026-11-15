import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSkill } from '@reelset/core'
import { saveDirectorSkillAction } from '@/app/admin/actions'
import { SkillForm } from '@/components/admin/director/SkillForm'
import { Flash, Toolbar, button } from '@/components/admin/ui'
import { ADMIN_ROUTES } from '@/lib/admin/nav'
import { fmtKb } from '@/lib/admin/director'
import { idSchema } from '@/lib/admin/retry'
import { assertAdmin } from '@/server/admin/guard'
import { getDb } from '@/server/db'

export const metadata = { title: 'Edit skill' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function EditSkillPage({ searchParams }: Props) {
  await assertAdmin()
  const sp = await searchParams
  const id = idSchema.safeParse({ id: Array.isArray(sp.id) ? sp.id[0] : sp.id })
  if (!id.success) notFound()
  const skill = await getSkill(getDb(), id.data.id)
  if (!skill) notFound()

  return (
    <div>
      <Flash value={sp.flash} />
      <Toolbar
        hint={`Editing ${skill.name} · ${fmtKb(skill.content.length)} of text`}
        actions={
          <Link href={ADMIN_ROUTES.director} className={button}>
            Back to director
          </Link>
        }
      />
      <SkillForm
        action={saveDirectorSkillAction}
        returnTo={`${ADMIN_ROUTES.director}/edit?id=${skill.id}`}
        submitLabel="Save"
        skill={skill}
      />
    </div>
  )
}
