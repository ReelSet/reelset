export type ImageSize = { width: number; height: number }

const ascii = (b: Uint8Array, at: number, s: string) =>
  [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8)
const u16be = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)
const u32be = (b: Uint8Array, at: number) =>
  ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || !ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null
  if (ascii(b, 12, 'VP8 ')) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b[20] !== 0x2f) return null
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(b, 12, 'VP8X')) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return null
}

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null
  return { width: u32be(b, 16), height: u32be(b, 20) }
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    if (SOF.has(marker)) return { width: u16be(b, i + 7), height: u16be(b, i + 5) }
    const len = u16be(b, i + 2)
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

/** Reads pixel dimensions from the header alone, so no decoder (sharp, wasm) is needed. */
export function imageSize(
  bytes: Uint8Array,
  type: 'image/jpeg' | 'image/png' | 'image/webp',
): ImageSize | null {
  const size =
    type === 'image/webp'
      ? webpSize(bytes)
      : type === 'image/png'
        ? pngSize(bytes)
        : jpegSize(bytes)
  return size && size.width > 0 && size.height > 0 ? size : null
}
