import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { svgPathProperties } from 'svg-path-properties'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const out = {}
const NUM = /^[\s,]*([-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?)/i
function fixArcs(d) {
  return d.replace(/([aA])([^a-zA-Z]*)/g, (_, cmd, rest) => {
    let r = rest, outp = []
    const take = (flag) => { if (flag) { const m = /^[\s,]*([01])/.exec(r); r = r.slice(m[0].length); return m[1] } const m = NUM.exec(r); r = r.slice(m[0].length); return m[1] }
    while (/\S/.test(r)) outp.push([take(), take(), take(), take(1), take(1), take(), take()].join(' '))
    return cmd + outp.join(cmd)
  })
}
for (const f of readdirSync(`${ROOT}/icons`).filter((x) => x.endsWith('.svg'))) {
  const s = readFileSync(`${ROOT}/icons/${f}`, 'utf8')
  const ds = []
  for (const m of s.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)\/?>/g)) {
    const a = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]))
    const n = (k) => Number(a[k] ?? 0)
    let d
    if (m[1] === 'path') d = a.d
    else if (m[1] === 'circle') d = `M${n('cx') - n('r')} ${n('cy')}a${n('r')} ${n('r')} 0 1 0 ${2 * n('r')} 0a${n('r')} ${n('r')} 0 1 0 ${-2 * n('r')} 0`
    else if (m[1] === 'ellipse') d = `M${n('cx') - n('rx')} ${n('cy')}a${n('rx')} ${n('ry')} 0 1 0 ${2 * n('rx')} 0a${n('rx')} ${n('ry')} 0 1 0 ${-2 * n('rx')} 0`
    else if (m[1] === 'line') d = `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`
    else if (m[1] === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'), r = Math.min(n('rx'), w / 2, h / 2); d = r ? `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z` : `M${x} ${y}h${w}v${h}h${-w}z` }
    else d = (m[1] === 'polygon' ? 'M' : 'M') + a.points.trim().replace(/\s+/g, ' L') + (m[1] === 'polygon' ? 'z' : '')
    d = fixArcs(d); let len = 60
    try { len = new svgPathProperties(d).getTotalLength() } catch { len = 60 }
    ds.push({ d, len })
  }
  out[f.replace('.svg', '')] = ds
}
writeFileSync(`${ROOT}/icons.json`, JSON.stringify(out))
console.log(Object.entries(out).map(([k, v]) => `${k}:${v.length}`).join(' '))
