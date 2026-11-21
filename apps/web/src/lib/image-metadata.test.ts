import { describe, expect, it } from 'vitest'
import { stripImageMetadata } from './image-metadata'
import { imageSize } from './image-size'

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  )
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'))
const u32be = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
const seg = (marker: number, body: string | number[]) => {
  const data = typeof body === 'string' ? [...body].map((c) => c.charCodeAt(0)) : body
  const len = data.length + 2
  return [0xff, marker, len >> 8, len & 0xff, ...data]
}

describe('stripImageMetadata: jpeg', () => {
  const sof = seg(0xc0, [8, 0, 64, 0, 64, 1, 1, 0x11, 0])
  const jpeg = bytes(
    [0xff, 0xd8],
    seg(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
    seg(0xe1, 'Exif\0\0GPSLatitude=51.5'),
    seg(0xfe, 'secret comment'),
    sof,
    seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56],
    [0xff, 0xd9],
  )

  it('drops APP1 EXIF and COM, keeps JFIF, frame and scan data', () => {
    const out = stripImageMetadata(jpeg, 'image/jpeg')!
    expect(has(out, 'GPSLatitude')).toBe(false)
    expect(has(out, 'secret comment')).toBe(false)
    expect(has(out, 'JFIF')).toBe(true)
    expect(imageSize(out, 'image/jpeg')).toEqual({ width: 64, height: 64 })
    expect(Array.from(out.slice(-7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])
  })

  it('rejects a segment that runs past the end', () => {
    expect(
      stripImageMetadata(bytes([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2]), 'image/jpeg'),
    ).toBe(null)
  })
})

describe('stripImageMetadata: png', () => {
  const chunk = (kind: string, data: number[]) => [
    ...u32be(data.length),
    ...[...kind].map((c) => c.charCodeAt(0)),
    ...data,
    0,
    0,
    0,
    0,
  ]
  const text = [...'Location\0Paris'].map((c) => c.charCodeAt(0))
  const png = bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...u32be(32), ...u32be(32), 8, 6, 0, 0, 0]),
    chunk('tEXt', text),
    chunk('eXIf', [1, 2, 3]),
    chunk('IDAT', [9, 9, 9]),
    chunk('IEND', []),
  )

  it('drops text and eXIf chunks and keeps image chunks', () => {
    const out = stripImageMetadata(png, 'image/png')!
    expect(has(out, 'Paris')).toBe(false)
    expect(has(out, 'eXIf')).toBe(false)
    expect(has(out, 'IDAT')).toBe(true)
    expect(imageSize(out, 'image/png')).toEqual({ width: 32, height: 32 })
  })

  it('rejects a png without IEND', () => {
    expect(stripImageMetadata(png.slice(0, png.length - 12), 'image/png')).toBe(null)
  })
})

describe('stripImageMetadata: webp', () => {
  const chunk = (kind: string, data: number[]) => [
    ...[...kind].map((c) => c.charCodeAt(0)),
    ...u32le(data.length),
    ...data,
    ...(data.length & 1 ? [0] : []),
  ]
  const body = [
    ...chunk('VP8X', [0x08 | 0x04, 0, 0, 0, 63, 0, 0, 63, 0, 0]),
    ...chunk('VP8L', [0x2f, 63, 0xc0, 0x0f, 0, 7]),
    ...chunk(
      'EXIF',
      [...'GPSInfo'].map((c) => c.charCodeAt(0)),
    ),
    ...chunk(
      'XMP ',
      [...'<xmp/>'].map((c) => c.charCodeAt(0)),
    ),
  ]
  const webp = bytes('RIFF', u32le(body.length + 4), 'WEBP', body)

  it('drops EXIF/XMP chunks, clears their VP8X flags and fixes the RIFF size', () => {
    const out = stripImageMetadata(webp, 'image/webp')!
    expect(has(out, 'GPSInfo')).toBe(false)
    expect(has(out, '<xmp/>')).toBe(false)
    expect(out[20]! & 0x0c).toBe(0)
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8)
    expect(imageSize(out, 'image/webp')).toEqual({ width: 64, height: 64 })
  })

  it('rejects trailing garbage', () => {
    expect(stripImageMetadata(Uint8Array.from([...webp, 1, 2, 3]), 'image/webp')).toBe(null)
  })
})
