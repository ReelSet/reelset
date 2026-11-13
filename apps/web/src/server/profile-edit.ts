import { errorFields, type Database, type Logger } from '@reelset/core'
import { sql } from 'kysely'
import sharp from 'sharp'
import {
  AVATAR_MAX_BYTES,
  AVATAR_SIZE,
  EDITS_PER_HOUR,
  profileDetailsSchema,
  sniffImageType,
} from '@/lib/profile-edit'

export type EditResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: 'invalid' | 'too_large' | 'unsupported' | 'rate_limited' }

/** Atomically claims one edit in a rolling hour window; false once EDITS_PER_HOUR is spent. */
export async function claimEdit(db: Database, profileId: string): Promise<boolean> {
  const expired = sql<boolean>`(edit_window_at is null or edit_window_at < now() - interval '1 hour')`
  const row = await db
    .updateTable('profile')
    .set({
      edit_count: sql<number>`case when ${expired} then 1 else edit_count + 1 end`,
      edit_window_at: sql<Date>`case when ${expired} then now() else edit_window_at end`,
    })
    .where('id', '=', profileId)
    .where(sql<boolean>`(${expired} or edit_count < ${EDITS_PER_HOUR})`)
    .returning('id')
    .executeTakeFirst()
  return Boolean(row)
}

export async function saveDetails(
  db: Database,
  profileId: string,
  input: unknown,
  log: Logger,
): Promise<EditResult<{ name: string; bio: string | null }>> {
  const parsed = profileDetailsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  if (!(await claimEdit(db, profileId))) {
    log.warn({ profileId }, 'profile edit rate limited')
    return { ok: false, error: 'rate_limited' }
  }
  try {
    await db
      .updateTable('profile')
      .set({ display_name: parsed.data.name, bio: parsed.data.bio, updated_at: new Date() })
      .where('id', '=', profileId)
      .execute()
    log.info({ profileId }, 'profile details saved')
    return { ok: true, value: { name: parsed.data.name, bio: parsed.data.bio } }
  } catch (err) {
    log.error(errorFields(err), 'profile details save failed')
    throw err
  }
}

export async function saveAvatar(
  db: Database,
  profileId: string,
  body: Uint8Array,
  log: Logger,
): Promise<EditResult> {
  if (body.byteLength === 0) return { ok: false, error: 'invalid' }
  if (body.byteLength > AVATAR_MAX_BYTES) return { ok: false, error: 'too_large' }
  if (!sniffImageType(body)) {
    log.warn({ profileId, bytes: body.byteLength }, 'avatar rejected: not jpeg/png/webp')
    return { ok: false, error: 'unsupported' }
  }
  let output: Buffer
  try {
    output = await sharp(body, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer()
  } catch (err) {
    log.warn({ profileId, ...errorFields(err) }, 'avatar rejected: undecodable image')
    return { ok: false, error: 'unsupported' }
  }
  if (!(await claimEdit(db, profileId))) {
    log.warn({ profileId }, 'avatar edit rate limited')
    return { ok: false, error: 'rate_limited' }
  }
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('profile_avatar')
        .values({ profile_id: profileId, content_type: 'image/webp', bytes: output })
        .onConflict((oc) =>
          oc.column('profile_id').doUpdateSet({
            content_type: 'image/webp',
            bytes: output,
            updated_at: new Date(),
          }),
        )
        .execute()
      await trx
        .updateTable('profile')
        .set({ avatar_hidden: false, updated_at: new Date() })
        .where('id', '=', profileId)
        .execute()
    })
    log.info({ profileId, bytes: output.byteLength }, 'avatar saved')
    return { ok: true, value: undefined }
  } catch (err) {
    log.error(errorFields(err), 'avatar save failed')
    throw err
  }
}

export async function removeAvatar(
  db: Database,
  profileId: string,
  log: Logger,
): Promise<EditResult> {
  if (!(await claimEdit(db, profileId))) {
    log.warn({ profileId }, 'avatar remove rate limited')
    return { ok: false, error: 'rate_limited' }
  }
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('profile_avatar').where('profile_id', '=', profileId).execute()
    await trx
      .updateTable('profile')
      .set({ avatar_hidden: true, updated_at: new Date() })
      .where('id', '=', profileId)
      .execute()
  })
  log.info({ profileId }, 'avatar removed')
  return { ok: true, value: undefined }
}

export async function loadAvatar(db: Database, profileId: string) {
  return db
    .selectFrom('profile_avatar')
    .select(['bytes', 'content_type'])
    .where('profile_id', '=', profileId)
    .executeTakeFirst()
}

export async function loadIdentityRow(db: Database, profileId: string) {
  return db
    .selectFrom('profile')
    .leftJoin('profile_avatar', 'profile_avatar.profile_id', 'profile.id')
    .select([
      'profile.display_name',
      'profile.bio',
      'profile.avatar_hidden',
      'profile_avatar.updated_at as avatar_updated_at',
    ])
    .where('profile.id', '=', profileId)
    .executeTakeFirst()
}
