export type SessionRow = { cmd: string; out: string[] }

const LEAD = '(?:sudo\\s+)?'
const PKG_FLAGS = '(?:-\\S+\\s+)*'

function lastSegment(url: string): string {
  const seg =
    url
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .split(/[/:]/)
      .pop() ?? ''
  return seg.replace(/\.git$/, '')
}

/** Output that is generic for the command (never tool versions, counts or file listings). */
export function outputFor(cmd: string): string[] {
  const c = cmd.trim()
  const clone = new RegExp(`^${LEAD}git clone\\s+(?:-\\S+\\s+)*(\\S+)(?:\\s+(\\S+))?`).exec(c)
  if (clone?.[1]) {
    const dir = clone[2] ?? lastSegment(clone[1])
    return [
      `Cloning into '${dir}'...`,
      'Receiving objects: 100%, done.',
      'Resolving deltas: 100%, done.',
    ]
  }
  const pip = new RegExp(`^${LEAD}(?:pip3?|pipx|uv pip) install\\s+${PKG_FLAGS}(\\S+)`).exec(c)
  if (pip?.[1])
    return [
      `Collecting ${pip[1]}`,
      `Installing collected packages: ${pip[1]}`,
      `Successfully installed ${pip[1]}`,
    ]
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b/.test(c))
    return ['Installing dependencies...', 'Done.']
  const npx = /^(?:npx|bunx|pnpm dlx)\s+(?:-\S+\s+)*(\S+)/.exec(c)
  if (npx?.[1]) return ['Need to install the following packages:', npx[1], 'Ok to proceed? (y) y']
  const cargo = new RegExp(`^cargo install\\s+${PKG_FLAGS}(\\S+)`).exec(c)
  if (cargo?.[1]) {
    return [
      '    Updating crates.io index',
      `  Installing ${cargo[1]}`,
      '    Finished `release` profile [optimized] target(s)',
      `   Installed package \`${cargo[1]}\``,
    ]
  }
  const brew = /^brew install\s+(?:-\S+\s+)*(\S+)/.exec(c)
  if (brew?.[1]) return [`==> Fetching ${brew[1]}`, `==> Pouring ${brew[1]}`, '==> Summary']
  const go = /^go install\s+(\S+)/.exec(c)
  if (go?.[1]) return [`go: downloading ${go[1].split('@')[0]}`]
  if (/^docker pull\b/.test(c)) return ['Status: Downloaded newer image']
  return []
}

/** A believable terminal session built only from the item's own command(s) and real facts. */
export function buildSession(
  given: readonly string[],
  repo: { owner?: string; name?: string; latestRelease?: string },
): SessionRow[] {
  const cmds = given
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 4)
  if (cmds.length === 0 && repo.name) {
    const dir = repo.name
    cmds.push(`git clone https://github.com/${repo.owner ?? 'owner'}/${dir}`, `cd ${dir}`)
    if (repo.latestRelease) cmds.push('git describe --tags --abbrev=0')
  }
  if (cmds.length === 0) return []
  return cmds.map((cmd) => ({
    cmd,
    out: /^git describe\b/.test(cmd) && repo.latestRelease ? [repo.latestRelease] : outputFor(cmd),
  }))
}

export type Reveal = { typed: number; shown: number }

/** How much of each row is visible at `budget` typed characters. */
export function revealSession(rows: readonly SessionRow[], budget: number): Reveal[] {
  let left = budget
  return rows.map((row) => {
    const typed = Math.max(0, Math.min(row.cmd.length, Math.floor(left)))
    const done = left >= row.cmd.length
    const shown = done ? Math.min(row.out.length, Math.floor((left - row.cmd.length) / 3) + 1) : 0
    left -= row.cmd.length + 4 + row.out.length * 3
    return { typed, shown: done ? Math.max(0, shown) : 0 }
  })
}

export function sessionLineCount(rows: readonly SessionRow[]): number {
  return rows.reduce((n, r) => n + 1 + r.out.length, 0) + 1
}

/** Largest font (px) that fits the session in `height`, capped for readability on a phone. */
export function sessionFont(lines: number, height: number): number {
  return Math.max(38, Math.min(64, Math.floor(height / (Math.max(1, lines) * 1.55))))
}

/** Like sessionFont, but counts the lines each command and output wraps to at that size. */
export function fitSessionFont(rows: readonly SessionRow[], width: number, height: number): number {
  for (let size = 64; size > 38; size -= 2) {
    const perLine = Math.max(8, Math.floor(width / (size * 0.62)))
    const wrapped = rows.reduce(
      (n, r) =>
        n +
        Math.ceil((r.cmd.length + 2) / perLine) +
        r.out.reduce((m, o) => m + Math.ceil(Math.max(1, o.length) / perLine), 0),
      1,
    )
    if (wrapped * size * 1.55 <= height) return size
  }
  return 38
}
