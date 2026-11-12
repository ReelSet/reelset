import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSkill } from '@reelset/core'
import { saveDirectorSkillAction } from '@/app/admin/actions'
import { SkillForm } from '@/components/admin/director/SkillForm'
import { Flash, PageTitle, button } from '@/components/admin/ui'
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
      <PageTitle title={`Edit ${skill.name}`} hint={`${fmtKb(skill.content.length)} of text`} />
      <Flash value={sp.flash} />
      <div className="mb-4">
        <Link href="/admin/director" className={button}>
          Back to director
        </Link>
      </div>
      <SkillForm
        action={saveDirectorSkillAction}
        returnTo={`/admin/director/edit?id=${skill.id}`}
        submitLabel="Save"
        skill={skill}
      />
    </div>
  )
}
