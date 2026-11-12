import { SubmitButton } from '@/components/admin/SubmitButton'
import { buttonPrimary, input } from '@/components/admin/ui'
import { DIRECTOR_SKILL_KINDS, DIRECTOR_SKILL_NAME_MAX_CHARS } from '@reelset/core'

type Props = {
  action: (formData: FormData) => Promise<void>
  returnTo: string
  submitLabel: string
  skill?: { id: string; name: string; kind: string; content: string }
}

export function SkillForm({ action, returnTo, submitLabel, skill }: Props) {
  return (
    <form action={action} className="grid gap-3 rounded-md border border-line bg-surface p-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      {skill && <input type="hidden" name="id" value={skill.id} />}
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs text-faint">
          Name
          <input
            name="name"
            required
            maxLength={DIRECTOR_SKILL_NAME_MAX_CHARS}
            defaultValue={skill?.name}
            className={`${input} w-72 font-mono text-xs`}
          />
        </label>
        <label className="grid gap-1 text-xs text-faint">
          Kind
          <select
            name="kind"
            defaultValue={skill?.kind ?? 'skill'}
            className={`${input} w-40 font-mono text-xs`}
          >
            {DIRECTOR_SKILL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-xs text-faint">
        Content (skill text, or a sample scene script for kind example)
        <textarea
          name="content"
          required
          rows={skill ? 32 : 10}
          spellCheck={false}
          defaultValue={skill?.content}
          className={`${input} w-full font-mono text-xs leading-relaxed`}
        />
      </label>
      <div>
        <SubmitButton className={buttonPrimary} pendingLabel="Saving">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  )
}
