// Word list and sentence patterns adapted from github.com/Jakeschincariol/instagram-agent-skill
// (skills/ig-human/slop.json, MIT, (c) Jake Schincariol). Entries that are real technical terms
// (ecosystem, harness, underscore, beacon, hack, landscape) are left out on purpose.

const SWAPS: readonly (readonly [string, string])[] = [
  ['delve into', 'look at'],
  ['delve', 'look'],
  ['dive deep into', 'get into'],
  ['deep dive', 'breakdown'],
  ['leverage', 'use'],
  ['leverages', 'uses'],
  ['leveraging', 'using'],
  ['utilize', 'use'],
  ['utilizes', 'uses'],
  ['utilizing', 'using'],
  ['embark on', 'start'],
  ['facilitate', 'help'],
  ['facilitates', 'helps'],
  ['showcase', 'show'],
  ['showcases', 'shows'],
  ['elevate', 'improve'],
  ['streamline', 'simplify'],
  ['streamlines', 'simplifies'],
  ['spearhead', 'lead'],
  ['revolutionize', 'change'],
  ['revolutionizes', 'changes'],
  ['transformative', 'big'],
  ['robust', 'solid'],
  ['seamless', 'smooth'],
  ['seamlessly', 'smoothly'],
  ['pivotal', 'key'],
  ['crucial', 'important'],
  ['comprehensive', 'complete'],
  ['cutting-edge', 'new'],
  ['game-changing', 'big'],
  ['game-changer', 'big deal'],
  ['game changer', 'big deal'],
  ['groundbreaking', 'new'],
  ['unparalleled', 'unmatched'],
  ['invaluable', 'useful'],
  ['meticulous', 'careful'],
  ['meticulously', 'carefully'],
  ['myriad of', 'many'],
  ['myriad', 'many'],
  ['multifaceted', 'complicated'],
  ['innovative', 'new'],
  ['testament to', 'proof of'],
  ['treasure trove', 'pile'],
  ['plethora of', 'lots of'],
  ['plethora', 'lots'],
  ['moreover', 'also'],
  ['furthermore', 'also'],
  ['additionally', 'also'],
  ['nevertheless', 'still'],
  ['consequently', 'so'],
  ['thus', 'so'],
  ['hence', 'so'],
  ['notably', ''],
  ['importantly', ''],
  ['ultimately', 'in the end'],
  ['in essence', 'basically'],
  ['in conclusion', 'so'],
  ['when it comes to', 'with'],
  ['in order to', 'to'],
  ['a wide range of', 'many'],
  ['it is worth noting that', ''],
  ["it's worth noting that", ''],
  ['supercharge', 'speed up'],
  ['supercharges', 'speeds up'],
  ['skyrocket', 'jump'],
  ['unleash', 'release'],
  ['effortlessly', 'easily'],
  ['no-brainer', 'easy call'],
  ['hidden gem', 'good find'],
  ['secret sauce', 'trick'],
  ['ultimate guide', 'guide'],
  ['level up', 'improve'],
  ["in today's fast-paced world", 'right now'],
  ["in today's digital age", 'right now'],
  ['in the ever-evolving landscape of', 'in'],
  ['in the ever-changing world of', 'in'],
  ["let's face it", ''],
  ["here's the thing", ''],
  ['picture this', ''],
  ["it's no secret that", ''],
  ["we've all been there", ''],
  ['let that sink in', ''],
  ['the choice is yours', ''],
  ['food for thought', ''],
  ['the future is here', ''],
  ['at the end of the day', ''],
  ['move the needle', 'make a difference'],
  ['without further ado', ''],
  ['buckle up', ''],
  ['the harsh truth is', ''],
  ['spoiler alert', ''],
  ['read that again', ''],
  ['stop scrolling', ''],
  ["don't scroll past this", ''],
  ["in today's video", ''],
  ['watch till the end', ''],
  ['this changed everything', 'this worked'],
  ['and just like that', ''],
  ['the rest is history', ''],
  ["run don't walk", ''],
  ['trust me on this one', ''],
  ["don't sleep on this", ''],
  ['hit follow for more', ''],
  ['follow for more', ''],
  ['let me know in the comments', ''],
]

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SWAP_RULES = [...SWAPS]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([find, to]) => ({
    find,
    to,
    re: new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(find)}(?![\\p{L}\\p{N}_-])[,:]?`, 'giu'),
  }))

const PATTERNS: readonly { id: string; re: RegExp; fix: string }[] = [
  {
    id: 'not-just',
    re: /\bit'?s not (?:just|only) [^.!?\n]{2,60}[,.] it'?s\b/i,
    fix: '"It\'s not just X, it\'s Y": say the one thing you mean and delete the setup half',
  },
  {
    id: 'not-only',
    re: /\bnot only\b[^.!?\n]{2,80}\bbut also\b/i,
    fix: '"Not only X but also Y": split it into two sentences or drop the weaker half',
  },
  {
    id: 'isnt-about',
    re: /\b(?:this|it) is(?:n'?t| not) about [^.!?\n]{2,60}[.!] it'?s about\b/i,
    fix: '"It isn\'t about X. It\'s about Y.": lead with Y',
  },
  {
    id: 'heres-what',
    re: /\bhere'?s what (?:i|we) learned\b/i,
    fix: '"Here\'s what we learned": state the lesson, skip the announcement',
  },
  {
    id: 'in-summary',
    re: /(?:^|[.!?]\s+)(?:in summary|to summarize|to sum up|in short)\b/i,
    fix: 'essay closer ("in summary"): end on the takeaway itself',
  },
  {
    id: 'preamble',
    re: /\b(?:in (?:this|today'?s) (?:video|reel|post)|today (?:i'?m|we'?re) going to show you|(?:i'?m|we'?re) going to (?:show|teach) you how)\b/i,
    fix: 'video preamble ("in this video"): delete it and start at the payoff',
  },
  {
    id: 'bait',
    re: /\b(?:follow for more|tag someone who|double tap if|share this if|comment below|link in bio|smash that)\b/i,
    fix: 'follow or comment bait: end on the takeaway, not an ask',
  },
]

const isSentenceStart = (text: string, index: number) =>
  /(?:^|[.!?]\s+)$/.test(text.slice(0, index))

/**
 * Swaps stock phrases for plain words in narration. A capitalised match in the middle of a sentence
 * is a name ("Leverage", a repo) and is left alone.
 */
export function cleanSlop(text: string): { text: string; swaps: string[] } {
  const swaps: string[] = []
  let out = text.replace(/\s*[—–]\s*(?!\d)/g, ', ')
  for (const rule of SWAP_RULES) {
    out = out.replace(rule.re, (match: string, index: number, whole: string) => {
      const capital = /^\p{Lu}/u.test(match)
      const start = isSentenceStart(whole, index)
      if (capital && !start) return match
      swaps.push(rule.find)
      if (!rule.to) return ''
      const tail = /[,:]$/.test(match) ? match.slice(-1) : ''
      return (capital ? rule.to[0]!.toUpperCase() + rule.to.slice(1) : rule.to) + tail
    })
  }
  if (swaps.length === 0 && out === text) return { text, swaps }
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/^[\s,;:]+/, '')
    .replace(/([.!?]\s+)[,;:]\s*/g, '$1')
    .replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .trim()
  return { text: out, swaps }
}

/** Sentence shapes that read as machine-written; these need a rewrite, so they are reported, not fixed. */
export function slopPatterns(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.fix)
}
