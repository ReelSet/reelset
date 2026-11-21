import { describe, expect, it } from 'vitest'
import { imageSize } from './image-size'

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  )

const riff = (chunk: string, body: number[]) =>
  bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body, new Array(16).fill(0))

describe('imageSize', () => {
  it('reads lossy VP8 webp', () => {
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x01, 0x00, 0x01])
    expect(imageSize(vp8, 'image/webp')).toEqual({ width: 256, height: 256 })
  })

  it('reads lossless VP8L webp', () => {
    const w = 255
    const h = 127
    const bits = w | (h << 14)
    const vp8l = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      bits >>> 24,
    ])
    expect(imageSize(vp8l, 'image/webp')).toEqual({ width: 256, height: 128 })
  })

  it('reads extended VP8X webp', () => {
    const vp8x = riff('VP8X', [0, 0, 0, 0, 0xff, 0, 0, 0x3f, 0, 0])
    expect(imageSize(vp8x, 'image/webp')).toEqual({ width: 256, height: 64 })
  })

  it('reads png IHDR', () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0, 0, 0, 13],
      'IHDR',
      [0, 0, 1, 0, 0, 0, 0, 200],
    )
    expect(imageSize(png, 'image/png')).toEqual({ width: 256, height: 200 })
  })

  it('walks jpeg segments to the SOF marker', () => {
    const app0 = [0xff, 0xe0, 0, 6, 1, 2, 3, 4]
    const sof = [0xff, 0xc0, 0, 11, 8, 0, 100, 0, 128, 3, 0, 0, 0]
    expect(imageSize(bytes([0xff, 0xd8], app0, sof), 'image/jpeg')).toEqual({
      width: 128,
      height: 100,
    })
  })

  it('rejects truncated, unknown and zero-sized headers', () => {
    expect(imageSize(bytes('RIFF'), 'image/webp')).toBeNull()
    expect(imageSize(riff('VP8 ', [0, 0, 0, 1, 2, 3]), 'image/webp')).toBeNull()
    expect(imageSize(riff('ALPH', []), 'image/webp')).toBeNull()
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]), 'image/jpeg')).toBeNull()
    const zero = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0, 0, 0, 13],
      'IHDR',
      [0, 0, 0, 0, 0, 0, 0, 1],
    )
    expect(imageSize(zero, 'image/png')).toBeNull()
  })
})
