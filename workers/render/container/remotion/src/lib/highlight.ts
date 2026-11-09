export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'call' | 'type' | 'plain'
export type Token = { text: string; kind: TokenKind }

const KEYWORDS = new Set(
  (
    'const let var function return if else for while do switch case break continue new class extends ' +
    'import export from default async await try catch finally throw typeof in of this super static ' +
    'public private protected interface type enum implements def lambda pass with as yield None True False ' +
    'self elif except raise not and or is fn pub mut impl trait struct use mod match loop ref where ' +
    'func package go defer chan select range nil true false null undefined void int string bool float ' +
    'select insert update delete create table join on group order by limit having begin end'
  ).split(' '),
)

const COMMENT = /\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\//
const STRING = /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?/
const NUMBER = /\b\d[\d_]*(?:\.\d+)?\b/
const WORD = /[A-Za-z_$][\w$]*/

const PATTERN = new RegExp(
  `(?<comment>${COMMENT.source})|(?<string>${STRING.source})|(?<number>${NUMBER.source})|(?<word>${WORD.source})`,
  'g',
)

export function tokenize(code: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const m of code.matchAll(PATTERN)) {
    const index = m.index ?? 0
    if (index > last) tokens.push({ text: code.slice(last, index), kind: 'plain' })
    const g = m.groups ?? {}
    const text = m[0]
    let kind: TokenKind = 'plain'
    if (g.comment) kind = 'comment'
    else if (g.string) kind = 'string'
    else if (g.number) kind = 'number'
    else if (g.word) {
      if (KEYWORDS.has(text)) kind = 'keyword'
      else if (code[index + text.length] === '(') kind = 'call'
      else if (/^[A-Z]/.test(text)) kind = 'type'
    }
    tokens.push({ text, kind })
    last = index + text.length
  }
  if (last < code.length) tokens.push({ text: code.slice(last), kind: 'plain' })
  return tokens
}

export function sliceTokens(tokens: readonly Token[], chars: number): Token[] {
  const out: Token[] = []
  let left = chars
  for (const token of tokens) {
    if (left <= 0) break
    out.push(left >= token.text.length ? token : { ...token, text: token.text.slice(0, left) })
    left -= token.text.length
  }
  return out
}

export function codeMetrics(code: string, width: number, maxHeight: number) {
  const lines = code.split('\n')
  const cols = Math.max(...lines.map((l) => l.length), 1)
  const maxSize = lines.length <= 5 ? 32 : 24
  const wrappedLines = (size: number) =>
    lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 0.62 * size) / width)), 0)
  let size = Math.floor(Math.min(maxSize, width / (cols * 0.62)))
  while (size > 20 && wrappedLines(size) * size * 1.55 > maxHeight) size -= 1
  size = Math.max(size, 20)
  while (size > 15 && wrappedLines(size) * size * 1.55 > maxHeight) size -= 1
  const wrap = cols * 0.62 * size > width
  return { size, wrap, lines: wrap ? wrappedLines(size) : lines.length }
}
