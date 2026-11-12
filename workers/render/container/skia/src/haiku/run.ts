// Experiment: Haiku writes the reel's illustration code (Skia canvas, no browser), reviews its own frames once, then we render.
// node dist/haiku.mjs <jobDir> [--skip-gen] [--no-review] [--stills-only]
import Anthropic from '@anthropic-ai/sdk'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerFonts } from '../engine/draw'
import { FPS, H, W } from '../engine/kit'
import { log } from '../engine/log'
import { buildReel, type Reel, type ReelProps, type Shot } from '../plan'
import { Renderer, assetPath } from '../render'
import type { Screen } from '../screens/types'
import * as K from './kit'

const MODEL = 'claude-haiku-5-5'
const SKILLS = ['motion-design', 'design-motion-principles', 'motion-doctrine', 'cut-the-curve']
const SKILL_ROOT = process.env.SKILL_ROOT ?? path.join(os.homedir(), '.agents', 'skills')
const EXAMPLE = process.env.EXAMPLE_SCENES ?? ''

const GRADES: Record<string, string> = {
  lime: 'format=gray,eq=contrast=1.3:brightness=0.03,format=rgb24,colorchannelmixer=rr=0.8:gg=0.98:bb=0.3',
  warm: 'eq=contrast=1.12:saturation=0.85:brightness=-0.03,colorbalance=rs=-0.03:bs=0.05:rm=0.04:bm=-0.03',
  dim: 'eq=saturation=0.45:contrast=1.08:brightness=-0.05',
  none: 'null',
}

type SceneDef = {
  t0: number
  t1: number
  fn: (t: number, lt: number, X: unknown) => void
  cap?: boolean
  tone?: 'ink' | 'bone' | 'lime'
  vid?: { clip: number; grade?: string } | null
  exit?: 'up'
}

function readSkills(): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir).sort()) {
      const p = path.join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.md'))
        parts.push(
          `<file path="${path.relative(SKILL_ROOT, p)}">\n${readFileSync(p, 'utf8')}\n</file>`,
        )
    }
  }
  for (const s of SKILLS) if (existsSync(path.join(SKILL_ROOT, s))) walk(path.join(SKILL_ROOT, s))
  return parts.join('\n\n')
}

const API_DOC = `
## Runtime (what your script can use)
Your script is plain JavaScript (no import/require/fetch/Date/Math.random). These are in scope as globals:
- Canvas: S (S.c is the current 2D context, Skia via @napi-rs/canvas: fillRect, arc, roundRect, drawImage, createLinearGradient, clip, save/restore, setLineDash, globalAlpha, Path2D, letterSpacing). W=1080, H=1920. 24 fps.
- COL: { ink:'#0b0b0e', ink2:'#16161b', bone:'#ece8dc', lime:'#c8f751', coral:'#ff5b3a', dim:'#8c8c95', white:'#f6f4ee' }
- Easing: clamp(v,a=0,b=1), pr(t,a,d) progress of t through [a,a+d] 0..1, eo expo-out (house ease), eo3, eo4, ei4 (power4 in), eio, eb(p, s=1.7) back-out (stamps/markers only), mix(a,b,p)
- Fonts (family names): 'BrikX' (Bricolage Grotesque 800, display), 'BrikB' (700), 'MonoM'/'MonoB' (JetBrains Mono 500/700), 'SerifI' (Instrument Serif italic), 'Geist' (UI). Latin only; other scripts fall back.
- font(fam,size,ls), measure(str,fam,size,ls) -> px, fit(str,fam,maxW,max,min=20,ls) -> size, wrap(str,fam,size,maxW,ls) -> lines
- text(str,x,y,fam,size,color,{ls,align,alpha}) baseline-aligned
- rise(str,x,base,size,fam,color,t,t0,{dur,ls,align,dist,out,outDur}) masked rise-in at t0 (optional masked exit at 'out'); returns width
- riseChars(str,x,base,size,fam,color,t,t0,{step,dur,ls,align})
- rrect(x,y,w,h,r) path only (then S.c.fill()/stroke()); bg(color) fills the frame
- icon(name,x,y,size,prog,color,lw=2) Lucide line icon drawn on by prog 0..1. ICON_NAMES lists the available names.
- stroke(points,prog,color,lw,{dx,dy,close}) polyline draw-on; polyLen(points)
- mk(w,h,g=>{...}) offscreen canvas drawn once (inside it the global S.c is that canvas). Build sprites ONCE (lazily, module scope), never per frame.
- cover(img,k=1,fx=.5,fy=.5,box?) cover-fit image/video frame into box (default full frame) zoomed k about focus; contain(img,box) whole image, returns drawn rect; blurred(img) full-frame blurred+dimmed copy (cached)
- sourceGlyph(source,x,y,size,light), sourceChip(source,label,x,y,size=1.6,light) -> width
- DATA: the reel data object below (title, images, broll, words...).
Scene fn(t, lt, X): t = absolute seconds (match against word start times), lt = seconds since scene start.
X.vid() -> current frame (720x1280 canvas, already graded) of this scene's stock clip if the scene declared vid, else null. Draw with cover(X.vid(), k).
X.img(i) -> decoded DATA.images[i] (or null). X.backdrop(i) = blurred(X.img(i)).

## Engine (done for you, do not draw these)
- Header at y 150-300: scene progress segments, source chip, reelset wordmark. Keep y < 310 empty.
- Captions: if a scene has cap:true the engine draws karaoke captions of the narration at baseline y=1530 (keep y 1420-1600 clear of important content). Use cap:false only when your scene's big type IS the spoken words.
- Phone UI covers y > 1600 and the right 150 px: keep text and key shapes inside x 96..929, y 310..1600.
- Seams between scenes: the engine pushes the outgoing scene left and the next one in (cut-the-curve). One scene may set exit:'up' (the reserved vector, for the conclusion).
- Grain, vignette and audio are added by the engine.

## Output contract
Return ONE \`\`\`js block: a script that defines helpers/sprites and ends with
  return [ { t0, t1, fn, cap, tone, vid, exit? }, ... ]
- Scenes are contiguous, sorted, first t0 = 0, last t1 = DATA.duration; 6-12 scenes, each about 2-6 s, cut on narration beats (word start times).
- tone: 'ink' (dark), 'bone' (light paper) or 'lime' page: the engine colors header/captions to match.
- vid: { clip: <index into DATA.broll>, grade: 'lime'|'warm'|'dim'|'none' } or null.
- fn must never throw: guard every image/video (they may be null). Keep per-frame work cheap (a 1-vCPU box renders this): no per-frame mk()/createCanvas, no filter blur, shadowBlur only on sprites.
`

const RULES = `
You are the motion designer and the programmer for one vertical developer-news reel (1080x1920, 24 fps). You write the drawing code yourself: every frame is drawn by your scene functions on a Skia canvas.
Visual language (house style):
- Palette ink/bone/lime/coral. Display type Bricolage 800 tight (ls -0.03..-0.04), labels in JetBrains Mono caps with tracking. No glow gradients, no neon, no emoji, no stock "AI" look.
- Signature ease: expo-out for entries; power4 in/out on exits; back-out only for stamps/stickers/markers. No linear motion, no bounce/elastic, no idle wobble. Stillness is allowed and good before a payoff.
- Every beat lands ON its spoken word: use DATA.words start times as the clock.
- Each scene is an illustration that explains the beat (diagrams, bars, counters, rankings, timelines, grids, before/after, stamps, icons drawn on), or kinetic type, or purposeful b-roll (knock-out type, push-ins). Vary the treatments across the reel; build causal motion (A changes because of B).
- Show the real source: when DATA.images has a thumbnail/og/screenshot/figure, use it (contained card over its blurred copy, or a figure zoom) — at least in the hook. Never invent logos.
- Numbers: only numbers that are in the narration, claims or facts. Never show views/stars/likes/upvotes or any count that changes over time.
- The first 1.5 s must hook: big type or the source image, motion within the first 0.2 s.
Read the motion skills below and apply them.
`

function dataOf(reel: Reel) {
  const p = reel.props
  return {
    title: p.title,
    source: p.source,
    sourceLabel: p.sourceLabel,
    domain: p.domain,
    headline: p.headline ?? null,
    duration: +p.durationSeconds.toFixed(2),
    narration: p.scenes.map((s) => ({
      kind: s.kind,
      start: +s.start.toFixed(2),
      end: +s.end.toFixed(2),
      text: s.text,
    })),
    words: p.words.map((w) => [w.text, +w.start.toFixed(2)]),
    claims: p.claims ?? [],
    facts: p.facts ?? {},
    images: (p.images ?? []).map((im, i) => ({
      index: i,
      kind: im.kind,
      width: im.width,
      height: im.height,
      about: im.caption ?? im.alt ?? '',
      focus: im.focus ?? null,
    })),
    broll: (p.broll ?? []).map((b, i) => ({
      index: i,
      seconds: b.seconds,
      about:
        (b.pageUrl ?? '')
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replace(/-\d+$/, '')
          .replace(/-/g, ' ') ?? '',
    })),
  }
}

function extractCode(text: string): string {
  const m = text.match(/```(?:js|javascript)?\n([\s\S]*?)```/g)
  if (!m) throw new Error('no code block in reply')
  const last = m.sort((a, b) => b.length - a.length)[0]!
  return last.replace(/^```(?:js|javascript)?\n/, '').replace(/```$/, '')
}

async function ask(
  client: Anthropic,
  system: Anthropic.TextBlockParam[],
  messages: Anthropic.MessageParam[],
): Promise<string> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 128000,
    output_config: { effort: (process.env.HAIKU_EFFORT ?? 'medium') as 'medium' },
    system,
    messages,
  })
  const msg = await stream.finalMessage()
  const u = msg.usage
  log.info(
    {
      stop: msg.stop_reason,
      in: u.input_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      out: u.output_tokens,
    },
    'haiku reply',
  )
  if (msg.stop_reason === 'refusal') throw new Error('haiku refused')
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

const KIT_NAMES = [
  'S',
  'W',
  'H',
  'COL',
  'clamp',
  'pr',
  'eo',
  'eo3',
  'eo4',
  'ei4',
  'eio',
  'eb',
  'mix',
  'font',
  'measure',
  'fit',
  'wrap',
  'text',
  'rise',
  'riseChars',
  'rrect',
  'bg',
  'icon',
  'ICON_NAMES',
  'stroke',
  'polyLen',
  'mk',
  'cover',
  'contain',
  'blurred',
  'sourceGlyph',
  'sourceChip',
  'Path2D',
] as const

/** Evaluates model-written scene code. Local experiment only: production would need a sandboxed process. */
function loadScenes(code: string, data: unknown): SceneDef[] {
  const kit = K as unknown as Record<string, unknown>
  const fn = new Function(...KIT_NAMES, 'DATA', `{\n${code}\n}`) as (...a: unknown[]) => SceneDef[]
  const scenes = fn(...KIT_NAMES.map((n) => kit[n]), data)
  if (!Array.isArray(scenes) || scenes.length === 0) throw new Error('script did not return scenes')
  return scenes
}

function applyScenes(base: Reel, scenes: SceneDef[], errors: Map<string, string>): Reel {
  const sorted = [...scenes].sort((a, b) => a.t0 - b.t0)
  const shots: Shot[] = sorted.map((s, i) => {
    const t0 = i === 0 ? 0 : s.t0
    const t1 = i + 1 < sorted.length ? sorted[i + 1]!.t0 : base.duration
    const clipIdx = s.vid && typeof s.vid.clip === 'number' ? s.vid.clip : null
    const clip = clipIdx !== null ? (base.props.broll?.[clipIdx] ?? null) : null
    const screen: Screen = {
      tone: () => (s.tone === 'bone' ? 'light' : s.tone === 'lime' ? 'lime' : 'dark'),
      captions: () => s.cap !== false,
      draw(a) {
        K.S.c = a.c
        const X = {
          vid: () => a.media.backdrop(),
          img: (k: number) => a.media.image(k),
          backdrop: (k: number) => K.blurred(a.media.image(k)),
        }
        try {
          s.fn(a.abs, a.t, X)
        } catch (err) {
          const key = `scene ${i} (${s.t0}-${s.t1}s): ${(err as Error).message}`
          if (!errors.has(key))
            errors.set(key, (err as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? '')
          throw err
        }
      },
    }
    return {
      index: i,
      show: 'KeyPoint',
      props: {},
      t0,
      t1,
      dur: t1 - t0,
      sceneIndex: i,
      origin: 'planned',
      topPad: 0,
      clip,
      enter: i === 0 ? null : sorted[i - 1]!.exit === 'up' ? 'up' : 'left',
      screen,
      grade: GRADES[s.vid?.grade ?? 'dim'] ?? GRADES.dim,
    }
  })
  return { ...base, shots, headline: null }
}

async function stillsSheet(
  reel: Reel,
  assets: string,
  times: number[],
  file: string,
): Promise<void> {
  const tw = 270
  const th = 480
  const cols = Math.min(6, times.length)
  const rows = Math.ceil(times.length / cols)
  const sheet = createCanvas(cols * tw, rows * (th + 34))
  const g = sheet.getContext('2d')
  g.fillStyle = '#333'
  g.fillRect(0, 0, sheet.width, sheet.height)
  for (const [i, abs] of times.entries()) {
    const r = new Renderer(reel, assets)
    await r.init()
    const shot = reel.shots.find((s) => abs >= s.t0 && abs < s.t1) ?? reel.shots.at(-1)!
    const skip = Math.max(0, abs - shot.t0)
    await r.ensure(shot, skip)
    const cv: Canvas = await r.frame(abs, Math.floor(skip * FPS + 1e-6))
    const x = (i % cols) * tw
    const y = Math.floor(i / cols) * (th + 34)
    g.drawImage(cv, x, y, tw, th)
    g.fillStyle = '#fff'
    g.font = '22px Geist'
    g.fillText(`scene ${shot.index} t=${abs.toFixed(2)}s`, x + 8, y + th + 25)
    r.close()
  }
  writeFileSync(file, await sheet.encode('jpeg', 82))
}

async function renderVideo(reel: Reel, jobDir: string, out: string): Promise<void> {
  const assets = path.join(jobDir, 'assets')
  const audio = path.join(assets, assetPath(reel.props.audio))
  const ff = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${W}x${H}`,
      '-r',
      String(FPS),
      '-i',
      '-',
      '-i',
      audio,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '22',
      '-maxrate',
      '3500k',
      '-bufsize',
      '7000k',
      '-x264-params',
      'threads=2:lookahead-threads=1:sync-lookahead=0:rc-lookahead=10:ref=2:bframes=2',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-t',
      reel.duration.toFixed(3),
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )
  const done = new Promise<void>((res, rej) =>
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)))),
  )
  const r = new Renderer(reel, assets)
  await r.init()
  const total = Math.ceil(reel.duration * FPS)
  const started = Date.now()
  for (let f = 0; f < total; f++) {
    const cv = await r.frame(f / FPS)
    if (!ff.stdin.write(cv.data())) await new Promise((res) => ff.stdin.once('drain', res))
  }
  ff.stdin.end()
  await done
  r.close()
  console.log(`video done frames=${total} ms=${Date.now() - started}`)
}

const args = process.argv.slice(2)
const jobDir = args[0]!
registerFonts()
const props = JSON.parse(readFileSync(path.join(jobDir, 'props.json'), 'utf8')) as ReelProps
const base = buildReel(props)
const data = dataOf(base)
const assets = path.join(jobDir, 'assets')
const work = path.join(jobDir, 'haiku')
mkdirSync(work, { recursive: true })
const errors = new Map<string, string>()

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
})
const example = EXAMPLE && existsSync(EXAMPLE) ? readFileSync(EXAMPLE, 'utf8') : ''
const system: Anthropic.TextBlockParam[] = [
  {
    type: 'text',
    text: `${RULES}\n${API_DOC}\nAvailable icons: ${K.ICON_NAMES.join(', ')}\n\n<example_scenes note="A hand-made reel about a different item (Gemini 4 Carbon pricing), written against this same kit (its imports are your globals; gemini() and iconPart() are not available to you). Learn the craft from it; do not copy its content.">\n${example}\n</example_scenes>\n\n<motion_skills>\n${readSkills()}\n</motion_skills>`,
    cache_control: { type: 'ephemeral' },
  },
]
const brief = `Here is the reel. Write the complete scene script.\n\nDATA = ${JSON.stringify(data)}`
const messages: Anthropic.MessageParam[] = [{ role: 'user', content: brief }]

let code: string
if (args.includes('--skip-gen') && existsSync(path.join(work, 'scenes.js')))
  code = readFileSync(path.join(work, 'scenes.js'), 'utf8')
else {
  const reply = await ask(client, system, messages)
  writeFileSync(path.join(work, 'reply1.md'), reply)
  code = extractCode(reply)
  writeFileSync(path.join(work, 'scenes1.js'), code)
  messages.push({ role: 'assistant', content: reply })
}

const sampleTimes = (reel: Reel) =>
  reel.shots.flatMap((s) => [s.t0 + Math.min(0.5, s.dur * 0.25), s.t0 + s.dur * 0.75])

let scenes: SceneDef[]
let loadError = ''
try {
  scenes = loadScenes(code, data)
} catch (err) {
  loadError = (err as Error).message
  log.warn({ err: loadError }, 'script failed to load')
  scenes = []
}
let reel = scenes.length ? applyScenes(base, scenes, errors) : base
await stillsSheet(reel, assets, sampleTimes(reel), path.join(work, 'review1.jpg'))

if (!args.includes('--no-review') && !args.includes('--skip-gen')) {
  const png = readFileSync(path.join(work, 'review1.jpg')).toString('base64')
  const errs = [...errors.entries()].map(([k, v]) => `- ${k} :: ${v}`).join('\n')
  messages.push({
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: png } },
      {
        type: 'text',
        text: `These are frames rendered from your script (two per scene: early and late; the header, captions and grain are the engine's). ${scenes.length ? '' : `Your script FAILED TO LOAD (${loadError}), so these are placeholder frames from a different renderer; ignore their look and fix the error.`}\n${errs ? `Runtime errors (the scene fell back to a placeholder):\n${errs}\n` : ''}Review them like a senior motion designer: text overflow or overlap, things off-frame or under the captions/phone UI, empty or dull frames, unreadable contrast, missing source image, generic look, anything that does not explain its beat. Then return the COMPLETE corrected script in one \`\`\`js block.`,
      },
    ],
  })
  const reply2 = await ask(client, system, messages)
  writeFileSync(path.join(work, 'reply2.md'), reply2)
  try {
    const code2 = extractCode(reply2)
    const s2 = loadScenes(code2, data)
    errors.clear()
    reel = applyScenes(base, s2, errors)
    code = code2
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'revised script failed; keeping the first')
  }
}
writeFileSync(path.join(work, 'scenes.js'), code)
await stillsSheet(reel, assets, sampleTimes(reel), path.join(work, 'final.jpg'))
if (!args.includes('--stills-only')) await renderVideo(reel, jobDir, path.join(work, 'haiku.mp4'))
console.log(JSON.stringify({ scenes: reel.shots.length, errors: [...errors.keys()], out: work }))
