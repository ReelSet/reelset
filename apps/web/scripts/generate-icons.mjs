import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const svg = readFileSync('src/app/icon.svg')
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0b0e"/><g transform="translate(51 51) scale(.8)">${svg
    .toString()
    .replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
    .replace(/<rect width="512"[^>]*\/>/, '')}</g></svg>`,
)

const png = (input, size) => sharp(input, { density: 384 }).resize(size, size).png().toBuffer()

writeFileSync('public/icon-192.png', await png(svg, 192))
writeFileSync('public/icon-512.png', await png(svg, 512))
writeFileSync('public/icon-maskable-512.png', await png(maskable, 512))
writeFileSync('src/app/apple-icon.png', await png(maskable, 180))

const sizes = [16, 32, 48]
const images = await Promise.all(sizes.map((s) => png(svg, s)))
const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = 6 + 16 * images.length
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16)
  e[0] = sizes[i]
  e[1] = sizes[i]
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(img.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += img.length
  return e
})
writeFileSync('src/app/favicon.ico', Buffer.concat([header, ...entries, ...images]))
