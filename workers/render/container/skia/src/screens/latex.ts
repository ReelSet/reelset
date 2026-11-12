const GREEK: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
}

const SYMBOL: Record<string, string> = {
  cdot: '·',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  sim: '∼',
  simeq: '≃',
  equiv: '≡',
  propto: '∝',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  mapsto: '↦',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  neg: '¬',
  land: '∧',
  lor: '∨',
  ldots: '…',
  cdots: '⋯',
  dots: '…',
  circ: '∘',
  star: '⋆',
  ast: '∗',
  oplus: '⊕',
  otimes: '⊗',
  langle: '⟨',
  rangle: '⟩',
  mid: '|',
  vert: '|',
  Vert: '‖',
  lVert: '‖',
  rVert: '‖',
  lbrace: '{',
  rbrace: '}',
  prime: '′',
  hbar: 'ħ',
  ell: 'ℓ',
  emptyset: '∅',
  top: '⊤',
  cdotp: '·',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  sum: 'Σ',
  prod: 'Π',
  int: '∫',
  oint: '∮',
  sqrt: '√',
}

const SPACE = new Set([',', ';', ':', ' ', 'quad', 'qquad', 'enspace', 'thinspace'])
const SKIP = new Set([
  '!',
  'limits',
  'nolimits',
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'nonumber',
  'label',
])
const WRAP_ONLY = new Set([
  'text',
  'textrm',
  'textit',
  'textbf',
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'mathtt',
  'mathcal',
  'mathscr',
  'mathfrak',
  'operatorname',
  'boldsymbol',
  'bm',
  'boxed',
  'underline',
  'overline',
])
const COMBINING: Record<string, string> = {
  hat: '\u0302',
  bar: '\u0304',
  tilde: '\u0303',
  vec: '\u20d7',
  dot: '\u0307',
  ddot: '\u0308',
}
const BLACKBOARD: Record<string, string> = {
  R: 'ℝ',
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  C: 'ℂ',
  E: '𝔼',
  P: 'ℙ',
}
const BIG_OPS = new Set([
  'sum',
  'prod',
  'int',
  'oint',
  'lim',
  'max',
  'min',
  'sup',
  'inf',
  'bigcup',
  'bigcap',
])
const SIZERS = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr'])

const SUP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '−': '⁻',
  n: 'ⁿ',
  i: 'ⁱ',
  T: 'ᵀ',
  '(': '⁽',
  ')': '⁾',
  '=': '⁼',
}
const SUB: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '−': '₋',
  '(': '₍',
  ')': '₎',
  '=': '₌',
  a: 'ₐ',
  e: 'ₑ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  n: 'ₙ',
  m: 'ₘ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
}

/** Reads a `{...}` group or a single token starting at `i`; returns its content and the index after it. */
function readArg(s: string, i: number): [string, number] {
  let j = i
  while (s[j] === ' ') j++
  if (s[j] !== '{') {
    if (s[j] === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(s.slice(j))
      return [m?.[0] ?? '', j + (m?.[0].length ?? 0)]
    }
    return [s[j] ?? '', j + 1]
  }
  let depth = 0
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') depth++
    else if (s[k] === '}' && --depth === 0) return [s.slice(j + 1, k), k + 1]
  }
  return [s.slice(j + 1), s.length]
}

const simple = (x: string) => /^[\p{L}\p{N}\p{M}.·′√\u2070-\u209f]+$/u.test(x) || x.length <= 1

function script(txt: string, kind: '^' | '_'): string {
  const map = kind === '^' ? SUP : SUB
  const chars = [...txt.replace(/\s+/g, '')]
  if (chars.length > 0 && chars.every((ch) => map[ch])) return chars.map((ch) => map[ch]).join('')
  if (!txt.trim()) return ''
  if (kind === '_' && [...txt].length === 1) return txt
  return simple(txt) ? `${kind}${txt}` : `${kind}(${txt})`
}

function limits(s: string, from: number): { text: string; end: number } {
  let i = from
  let sub = ''
  let sup = ''
  let end = from
  for (;;) {
    while (s[i] === ' ') i++
    if (s[i] !== '_' && s[i] !== '^') break
    const [g, next] = readArg(s, i + 1)
    if (s[i] === '_') sub = render(g)
    else sup = render(g)
    i = next
    end = next
  }
  if (!sub && !sup) return { text: '', end: from }
  const text = sub && sup ? `(${sub}…${sup})` : `(${sub || sup})`
  return { text, end }
}

function command(name: string, s: string, i: number): { out: string; end: number } {
  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    const [a, e1] = readArg(s, i)
    const [b, e2] = readArg(s, e1)
    const [x, y] = [render(a), render(b)]
    return { out: `${simple(x) ? x : `(${x})`}/${simple(y) ? y : `(${y})`}`, end: e2 }
  }
  if (name === 'sqrt') {
    let j = i
    let root = ''
    if (s[j] === '[') {
      const close = s.indexOf(']', j)
      root = render(s.slice(j + 1, close))
      j = close + 1
    }
    const [g, end] = readArg(s, j)
    const x = render(g)
    return { out: `${root ? script(root, '^') : ''}√${simple(x) ? x : `(${x})`}`, end }
  }
  if (name === 'mathbb') {
    const [g, end] = readArg(s, i)
    return { out: BLACKBOARD[g] ?? g, end }
  }
  if (WRAP_ONLY.has(name)) {
    const [g, end] = readArg(s, i)
    return { out: render(g), end }
  }
  if (name in COMBINING) {
    const [g, end] = readArg(s, i)
    const x = render(g)
    return { out: x.length ? `${x.slice(0, 1)}${COMBINING[name]}${x.slice(1)}` : x, end }
  }
  if (name === 'begin' || name === 'end') return { out: '', end: readArg(s, i)[1] }
  if (SIZERS.has(name)) {
    const [d, end] = readArg(s, i)
    return { out: d === '.' ? '' : render(d), end }
  }
  if (BIG_OPS.has(name)) {
    const sym = SYMBOL[name] ?? name
    const lim = limits(s, i)
    return { out: `${sym}${lim.text}`, end: lim.end }
  }
  if (SPACE.has(name)) return { out: ' ', end: i }
  if (SKIP.has(name)) return { out: '', end: i }
  if (name === '\\') return { out: '\n', end: i }
  const known = GREEK[name] ?? SYMBOL[name]
  if (known) return { out: known, end: i }
  if (name === '|') return { out: '‖', end: i }
  if (/^[{}%&_#$]$/.test(name)) return { out: name === '&' ? ' ' : name, end: i }
  return { out: /^[A-Za-z]+$/.test(name) ? name : '', end: i }
}

function render(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/s.exec(s.slice(i))
      if (!m) break
      const r = command(m[1]!, s, i + m[0].length)
      out += r.out
      i = r.end
    } else if (ch === '^' || ch === '_') {
      const [g, end] = readArg(s, i + 1)
      out += script(render(g), ch)
      i = end
    } else if (ch === '{' || ch === '}' || ch === '$') i++
    else if (ch === '&') {
      out += ' '
      i++
    } else {
      out += ch
      i++
    }
  }
  return out
}

/** LaTeX as plain, legible text lines (no browser, no KaTeX): fractions, scripts, Greek and operators become Unicode. */
export function latexToText(latex: string): string[] {
  const spaced = render(latex.trim())
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*(=|≈|≠|≤|≥|→|⇒|∼|≡)\s*/g, ' $1 ')
    .replace(/(\S)\s*\+\s*(\S)/g, '$1 + $2')
  return spaced
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
}
