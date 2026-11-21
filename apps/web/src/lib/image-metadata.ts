type ImageType = 'image/jpeg' | 'image/png' | 'image/webp'

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!
const u32be = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!
const u32le = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// APP0 (JFIF) and APP14 (Adobe colour transform) change how pixels decode; every other APPn
// and COM segment is metadata (EXIF/GPS, XMP, ICC, maker notes, comments).
const KEEP_JPEG_APP = new Set([0xe0, 0xee])

function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i += 1
      continue
    }
    if (marker === 0xda) {
      parts.push(b.subarray(i))
      return concat(parts)
    }
    if (marker === 0xd9) return null
    const len = u16be(b, i + 2)
    if (len < 2 || i + 2 + len > b.length) return null
    const isMeta =
      (marker >= 0xe0 && marker <= 0xef && !KEEP_JPEG_APP.has(marker)) || marker === 0xfe
    if (!isMeta) parts.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return null
}

const PNG_META = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'iCCP'])

function stripPng(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || b[0] !== 0x89 || !ascii(b, 1, 'PNG')) return null
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = u32be(b, i)
    const end = i + 12 + len
    if (end > b.length) return null
    const kind = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!)
    if (!PNG_META.has(kind)) parts.push(b.subarray(i, end))
    i = end
    if (kind === 'IEND') return concat(parts)
  }
  return null
}

const WEBP_META = new Set(['EXIF', 'XMP ', 'ICCP'])
const VP8X_META_FLAGS = 0x20 | 0x08 | 0x04

function stripWebp(b: Uint8Array): Uint8Array | null {
  if (b.length < 12 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  const chunks: Uint8Array[] = []
  let i = 12
  while (i + 8 <= b.length) {
    const len = u32le(b, i + 4)
    const end = i + 8 + len + (len & 1)
    if (end > b.length) return null
    const kind = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)
    if (!WEBP_META.has(kind)) {
      const chunk = b.slice(i, end)
      if (kind === 'VP8X') chunk[8] = chunk[8]! & ~VP8X_META_FLAGS
      chunks.push(chunk)
    }
    i = end
  }
  if (i !== b.length || chunks.length === 0) return null
  const body = concat(chunks)
  const header = new Uint8Array(12)
  header.set(b.subarray(0, 12))
  new DataView(header.buffer).setUint32(4, body.length + 4, true)
  return concat([header, body])
}

/**
 * Drops EXIF/GPS, XMP, ICC and text metadata without decoding pixels, so uploads that skip the
 * browser's canvas re-encode do not leak where a photo was taken. Null means a malformed file.
 */
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array | null {
  if (type === 'image/jpeg') return stripJpeg(bytes)
  if (type === 'image/png') return stripPng(bytes)
  return stripWebp(bytes)
}
