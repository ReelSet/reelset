import { AVATAR_MAX_BYTES, AVATAR_SIZE, AVATAR_TYPES } from '@/lib/profile-edit'

export type PickedAvatar = { blob: Blob; previewUrl: string }

/** Center-crops to a square and downsizes in the browser so uploads stay tiny. */
export async function cropToAvatar(file: File): Promise<PickedAvatar> {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) throw new Error('type')
  if (file.size > AVATAR_MAX_BYTES) throw new Error('size')
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new Error('encode')
  return { blob, previewUrl: URL.createObjectURL(blob) }
}
