import {
  Freeze,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { Pop, Rise, easeOut } from '../fx'
import { codeMetrics, tokenize, type TokenKind } from '../lib/highlight'
import { demoBox } from '../lib/images'
import { fitText } from '../lib/text'
import { buildSession, fitSessionFont, revealSession } from '../lib/terminal'
import {
  COLOR,
  CONTENT_TOP,
  CONTENT_W,
  FONT,
  H,
  LOW_TOP,
  MONO,
  SAFE,
  W,
  ZONE_BOTTOM,
} from '../theme'
import {
  Chip,
  Page,
  compact,
  ghLanguageColor,
  grouped,
  prop,
  useCount,
  type ScreenProps,
} from './ui'

function repoIdentity(ctx: ScreenProps['ctx']): { owner: string; name: string } {
  const r = ctx.facts.repo
  if (r?.owner && r.name) return { owner: r.owner, name: r.name }
  const d = /^([^/\s]+)\/([^/\s]+)$/.exec(ctx.demo?.repo ?? '')
  if (d?.[1] && d[2]) return { owner: d[1], name: d[2] }
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)/.exec(ctx.domain)
  if (m?.[1] && m[2]) return { owner: m[1], name: m[2] }
  const parts = ctx.title.split('/')
  if (parts.length === 2 && parts[0] && parts[1])
    return { owner: parts[0].trim(), name: parts[1].trim() }
  return { owner: '', name: ctx.title }
}

const RepoIcon = ({ size = 56 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={COLOR.muted}>
    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
  </svg>
)

const Star = ({ size = 44, color = '#e3b341' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
    <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
  </svg>
)

const Fork = ({ size = 44 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={COLOR.text}>
    <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
  </svg>
)

export function RepoPage({ frames, ctx, topPad }: ScreenProps) {
  const { owner, name } = repoIdentity(ctx)
  const r = ctx.facts.repo
  const desc = r?.description ?? ''
  const demo = ctx.demo
  const count = useCount(frames, 0.55)
  const nameSize = fitText(
    name,
    { width: CONTENT_W, height: 130 },
    { min: 56, max: 110, charWidth: 0.6, lineHeight: 1.05 },
  )
  const langs =
    r?.languages && r.languages.length > 0
      ? r.languages.slice(0, 5)
      : r?.language
        ? [{ name: r.language, pct: 100 }]
        : []
  const topics = (r?.topics ?? []).slice(0, 6)
  const stat = (n: number | undefined) => (n === undefined ? null : grouped(n * count))
  return (
    <Page frames={frames} topPad={topPad}>
      <Rise>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            color: COLOR.muted,
            fontSize: 44,
            fontWeight: 600,
          }}
        >
          <RepoIcon />
          {owner ? <span>{owner} /</span> : null}
        </div>
        <div
          style={{
            fontSize: nameSize,
            fontWeight: 800,
            letterSpacing: '-0.035em',
            lineHeight: 1.02,
            marginTop: 8,
            color: '#58a6ff',
            overflowWrap: 'anywhere',
          }}
        >
          {name}
        </div>
      </Rise>
      {desc ? (
        <Rise
          delay={5}
          style={{
            marginTop: 34,
            fontSize: topics.length || langs.length ? 46 : 56,
            lineHeight: 1.22,
            color: '#c9d1d9',
            fontWeight: 500,
            maxHeight: 290,
            overflow: 'hidden',
          }}
        >
          {desc}
        </Rise>
      ) : null}
      <div style={{ display: 'flex', gap: 22, marginTop: 40, flexWrap: 'wrap' }}>
        {stat(r?.stars) ? (
          <Pop delay={8}>
            <Chip size={44} bg="rgba(255,255,255,0.1)">
              <Star />
              Star <b style={{ color: '#e3b341' }}>{stat(r?.stars)}</b>
            </Chip>
          </Pop>
        ) : null}
        {stat(r?.forks) ? (
          <Pop delay={12}>
            <Chip size={44} bg="rgba(255,255,255,0.1)">
              <Fork />
              Fork <b>{stat(r?.forks)}</b>
            </Chip>
          </Pop>
        ) : null}
      </div>
      {langs.length > 0 ? (
        <div style={{ marginTop: 40 }}>
          <div style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', gap: 3 }}>
            {langs.map((l) => (
              <div
                key={l.name}
                style={{
                  flex: l.pct * count + 0.001,
                  background: ghLanguageColor[l.name] ?? COLOR.accent,
                }}
              />
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 30,
              marginTop: 20,
              flexWrap: 'wrap',
              fontSize: 34,
              fontWeight: 600,
            }}
          >
            {langs.map((l) => (
              <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <i
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    background: ghLanguageColor[l.name] ?? COLOR.accent,
                  }}
                />
                {l.name}
                {langs.length > 1 ? (
                  <span style={{ color: COLOR.muted }}>{l.pct.toFixed(1)}%</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {topics.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 36 }}>
          {topics.map((t, i) => (
            <Pop key={t} delay={14 + i * 3}>
              <Chip size={32} color="#58a6ff" bg="rgba(56,139,253,0.15)">
                {t}
              </Chip>
            </Pop>
          ))}
        </div>
      ) : null}
      {demo ? (
        <Pop delay={6} style={{ marginTop: 40 }}>
          <div
            style={{
              border: `2px solid ${COLOR.line}`,
              borderRadius: 24,
              overflow: 'hidden',
              background: COLOR.surface,
            }}
          >
            <div
              style={{
                padding: '18px 28px',
                fontSize: 32,
                color: COLOR.muted,
                fontWeight: 700,
                borderBottom: `2px solid ${COLOR.line}`,
              }}
            >
              README.md
            </div>
            <Freeze frame={Math.round(Math.min(2, demo.seconds / 2) * 30)}>
              <OffthreadVideo
                src={staticFile(demo.src)}
                muted
                style={{
                  display: 'block',
                  width: '100%',
                  height: Math.min(
                    460,
                    Math.round(((CONTENT_W - 4) * (demo.height ?? 720)) / (demo.width ?? 1280)),
                  ),
                  objectFit: 'contain',
                  background: '#000',
                }}
              />
            </Freeze>
          </div>
        </Pop>
      ) : null}
    </Page>
  )
}

export function Terminal({ frames, ctx, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const { owner, name } = repoIdentity(ctx)
  const r = ctx.facts.repo
  const rows = buildSession(prop<string[]>(props, 'lines', []), {
    owner,
    name,
    latestRelease: r?.latestRelease,
  })
  const top = CONTENT_TOP + topPad - 28
  const termH = LOW_TOP - top - 24
  const size = fitSessionFont(rows, W - SAFE.left - SAFE.right, termH - 190)
  const chars = rows.reduce((n, row) => n + row.cmd.length + 4 + row.out.length * 3, 0)
  const budget = frame * (chars / Math.max(12, frames * 0.62))
  const reveal = revealSession(rows, budget)
  const allDone = reveal.every(
    (v, i) => v.typed >= (rows[i]?.cmd.length ?? 0) && v.shown >= (rows[i]?.out.length ?? 0),
  )
  const cursorOn = Math.floor(frame / 8) % 2 === 0
  const facts = [
    r?.stars !== undefined ? `★ ${grouped(r.stars)}` : null,
    r?.language ?? null,
    r?.latestRelease ?? null,
  ].filter((x): x is string => Boolean(x))
  const desc = r?.description ?? ''
  const demo = ctx.demo
  return (
    <Page frames={frames} bleed topPad={topPad}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top,
          width: W,
          height: termH,
          overflow: 'hidden',
          background: '#0b0b0e',
          borderTop: `2px solid ${COLOR.line}`,
          borderBottom: `2px solid ${COLOR.line}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '26px 40px',
            borderBottom: `2px solid ${COLOR.line}`,
            background: '#141418',
          }}
        >
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <i key={c} style={{ width: 26, height: 26, borderRadius: 13, background: c }} />
          ))}
          <span style={{ marginLeft: 20, fontFamily: MONO, fontSize: 32, color: COLOR.muted }}>
            zsh ~/projects
          </span>
        </div>
        <div
          style={{
            padding: `34px ${SAFE.right}px 0 ${SAFE.left}px`,
            fontFamily: MONO,
            fontSize: size,
            lineHeight: 1.45,
          }}
        >
          {rows.map((row, i) => {
            const v = reveal[i]!
            if (i > 0 && v.typed === 0) return null
            const typing = v.typed < row.cmd.length
            return (
              <div key={i} style={{ marginBottom: size * 0.3 }}>
                <div style={{ wordBreak: 'break-all' }}>
                  <span style={{ color: COLOR.accent }}>$ </span>
                  {row.cmd.slice(0, v.typed)}
                  {typing && cursorOn ? <span style={{ background: COLOR.text }}> </span> : null}
                </div>
                {row.out.slice(0, v.shown).map((o, k) => (
                  <div
                    key={k}
                    style={{
                      color: /^(?:Successfully|Done|Finished|Installed|v?\d)/.test(o)
                        ? '#3fb950'
                        : COLOR.muted,
                      wordBreak: 'break-all',
                    }}
                  >
                    {o}
                  </div>
                ))}
              </div>
            )
          })}
          {allDone ? (
            <div>
              <span style={{ color: COLOR.accent }}>$ </span>
              {cursorOn ? <span style={{ background: COLOR.text }}> </span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ position: 'absolute', left: SAFE.left, right: SAFE.right, top: LOW_TOP + 10 }}>
        {facts.length > 0 ? (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
            {facts.map((f) => (
              <Chip key={f} size={38} bg="rgba(255,255,255,0.1)">
                {f}
              </Chip>
            ))}
          </div>
        ) : null}
        <div
          style={{
            fontSize: 40,
            lineHeight: 1.3,
            color: '#d4d4d8',
            fontWeight: 600,
            maxHeight: 170,
            overflow: 'hidden',
          }}
        >
          {desc}
        </div>
      </div>
    </Page>
  )
}

const KIND_COLOR: Record<TokenKind, string> = {
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#6e7681',
  call: '#d2a8ff',
  type: '#ffa657',
  plain: '#e6edf3',
}

const EXT: Record<string, string> = {
  python: 'py',
  py: 'py',
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  rust: 'rs',
  go: 'go',
  bash: 'sh',
  sh: 'sh',
  sql: 'sql',
  json: 'json',
  yaml: 'yml',
  tsx: 'tsx',
  java: 'java',
}

export function CodeBlock({ frames, props, topPad }: ScreenProps) {
  const frame = useCurrentFrame()
  const code = prop<string>(props, 'code', '').replace(/\s+$/, '')
  const language = prop<string>(props, 'language', 'text')
  const lines = code.split('\n')
  const metrics = codeMetrics(code, CONTENT_W - 100, 640, lines.length <= 2 ? 2.3 : 1.45)
  const size = metrics.size
  // Lines land whole (one every 4 frames), never a half-typed fragment like "v=".
  const shownLines = Math.min(lines.length, 1 + Math.floor(Math.max(0, frame - 2) / 4))
  const cursorLine = Math.min(lines.length - 1, shownLines - 1)
  const ext = EXT[language.toLowerCase()] ?? language.toLowerCase()
  return (
    <Page frames={frames} bleed topPad={topPad}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: CONTENT_TOP + topPad,
          width: W,
          bottom: 0,
          background: '#0d1117',
          borderTop: `2px solid ${COLOR.line}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            background: '#161b22',
            borderBottom: `2px solid ${COLOR.line}`,
          }}
        >
          <div
            style={{
              padding: '24px 44px',
              fontFamily: MONO,
              fontSize: 32,
              color: COLOR.text,
              background: '#0d1117',
              borderTop: `4px solid ${COLOR.accent}`,
            }}
          >
            snippet.{ext}
          </div>
        </div>
        <div
          style={{
            padding: `${lines.length <= 2 ? Math.max(36, (ZONE_BOTTOM - CONTENT_TOP - topPad - 90 - lines.length * size * 1.5) / 2) : 36}px ${SAFE.right}px 0 ${SAFE.left}px`,
            fontFamily: MONO,
            fontSize: size,
            lineHeight: 1.5,
          }}
        >
          {lines.map((line, i) => {
            if (i >= shownLines) return null
            const tokens = tokenize(line)
            const active = i === cursorLine
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 28,
                  background: active ? 'rgba(200,247,81,0.07)' : undefined,
                  borderRadius: 8,
                  whiteSpace: metrics.wrap ? 'pre-wrap' : 'pre',
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ width: 52, textAlign: 'right', color: '#484f58', flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span>
                  {tokens.map((t, k) => (
                    <span key={k} style={{ color: KIND_COLOR[t.kind] }}>
                      {t.text}
                    </span>
                  ))}
                </span>
              </div>
            )
          })}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: LOW_TOP - (CONTENT_TOP + topPad) + 40,
            padding: `0 ${SAFE.right}px 0 ${SAFE.left}px`,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: FONT,
            fontSize: 34,
            color: COLOR.muted,
            fontWeight: 600,
          }}
        >
          <span>{language}</span>
          <span>
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </div>
    </Page>
  )
}

/** README demo clip, full-bleed; a blurred copy fills the frame when the clip does not. */
export function RepoDemo({ frames, ctx, props, topPad }: ScreenProps) {
  const { fps } = useVideoConfig()
  const frame = useCurrentFrame()
  const demo = ctx.demo
  if (!demo) return <Page frames={frames} topPad={topPad} />
  const offset = Math.min(
    prop<number>(props, 'offset', 0),
    Math.max(0, demo.seconds - frames / fps),
  )
  const startFrom = Math.round(offset * fps)
  const box = demoBox(demo.width ?? 1280, demo.height ?? 720, CONTENT_TOP + topPad)
  const zoom = interpolate(frame, [0, Math.max(1, frames)], [1, box.fullBleed ? 1.05 : 1.03], {
    extrapolateRight: 'clamp',
  })
  const { owner, name } = repoIdentity(ctx)
  const label = owner && name ? `github.com/${owner}/${name}` : ctx.domain
  return (
    <Page frames={frames} bleed topPad={topPad}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          filter: 'blur(44px) brightness(0.4) saturate(1.2)',
        }}
      >
        <OffthreadVideo
          src={staticFile(demo.src)}
          muted
          startFrom={startFrom}
          style={{ width: W, height: H, objectFit: 'cover' }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          overflow: 'hidden',
          borderRadius: box.fullBleed ? 0 : 18,
          boxShadow: box.fullBleed ? undefined : '0 30px 80px rgba(0,0,0,0.55)',
          transform: box.fullBleed ? undefined : `scale(${zoom})`,
        }}
      >
        <OffthreadVideo
          src={staticFile(demo.src)}
          muted
          startFrom={startFrom}
          style={{
            width: box.width,
            height: box.height,
            objectFit: box.fullBleed ? 'cover' : 'contain',
            transform: box.fullBleed ? `scale(${zoom})` : undefined,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: box.fullBleed ? SAFE.left : box.left,
          top: box.fullBleed ? CONTENT_TOP + topPad : box.top + box.height + 16,
        }}
      >
        <Chip size={24} bg="rgba(9,9,11,0.72)" color={COLOR.muted}>
          <i style={{ width: 10, height: 10, borderRadius: 5, background: COLOR.accent }} />
          Demo · {label}
        </Chip>
      </div>
    </Page>
  )
}
