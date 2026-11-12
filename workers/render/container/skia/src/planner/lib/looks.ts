// Small pure rules behind screen layouts, kept here so they are unit-tested.

/** What a short snippet is, for its label: "dns" -> "DNS record", "bash" -> "Shell command". */
export function codeKind(language: string): string {
  const l = language.toLowerCase().trim()
  if (l === 'dns' || l === 'zone' || l === 'bind') return 'DNS record'
  if (['bash', 'sh', 'shell', 'zsh', 'console'].includes(l)) return 'Shell command'
  if (['yaml', 'yml', 'toml', 'ini', 'json', 'env'].includes(l)) return `${l.toUpperCase()} config`
  if (!l || l === 'text' || l === 'plain') return 'Snippet'
  return `${l.charAt(0).toUpperCase()}${l.slice(1)} snippet`
}

/** One or two short lines read best as a card, set large and centred, not an editor that is 80% empty. */
export const isShortCode = (lines: readonly string[]): boolean =>
  lines.length <= 2 && lines.every((l) => l.length <= 48)

/**
 * Lines a short snippet is set on: a one-line DNS record breaks after each `tag=value;` so the tags
 * stack large ("v=DMARC1;" / "p=none;") instead of one small line in an empty card.
 */
export function cardLines(code: string, language: string): string[] {
  const lines = code.replace(/\s+$/, '').split('\n')
  const l = language.toLowerCase().trim()
  const dns = l === 'dns' || l === 'zone' || l === 'bind'
  if (!dns || lines.length !== 1) return lines
  const tags =
    (lines[0] ?? '')
      .match(/[^;]+;?/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? []
  return tags.length >= 2 && tags.length <= 4 ? tags : lines
}

/** Width in px of the BarRace value column (84 px type): the longest value on one line, 220-420. */
export function barValueWidth(values: readonly string[]): number {
  const longest = Math.max(0, ...values.map((v) => v.length))
  return Math.min(420, Math.max(220, Math.ceil(longest * 84 * 0.6) + 10))
}
