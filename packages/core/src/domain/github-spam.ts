export const SPAM_SCORE_THRESHOLD = 3

export type GithubSpamInput = {
  fullName: string
  description?: string | null
  topics?: readonly string[] | null
  language?: string | null
  stars: number
  createdAt: Date | string
  ownerLogin?: string | null
  ownerType?: string | null
  ownerCreatedAt?: Date | string | null
  readme?: string | null
  now?: Date
}

export type GithubSpamVerdict = { spam: boolean; score: number; reasons: string[] }

type Signal = { reason: string; weight: number }

const DAY_MS = 24 * 60 * 60 * 1000
const NEW_OWNER_DAYS = 30
const ANOMALOUS_STARS = 300
const IMPLAUSIBLE_STARS_PER_DAY = 2000
const OWNER_SHAPE_CAP = 2

const COMMERCIAL_SOFTWARE = [
  'abbyy',
  'ableton',
  'adobe',
  'aida-?64',
  'aiseesoft',
  'aomei',
  'archicad',
  'ashampoo',
  'autocad',
  'autodesk',
  'avid-media',
  'camtasia',
  'canva-pro',
  'catia',
  'cinema-?4d',
  'drfone',
  'easeus',
  'easy-?worship',
  'fabfilter',
  'fl-?studio',
  'filmora',
  'fone(?:azy|paw|trans)',
  'foneazy',
  'glary',
  'idm-',
  'ifunbox',
  'imobie',
  'imyfone',
  'iobit',
  'keyshot',
  'landr',
  'melodyne',
  'microstation',
  'movavi',
  'nero-',
  'on1-photo',
  'ozone-?\\d+',
  'passfab',
  'photoshop',
  'php-?storm',
  'quicken',
  'reason-\\d+',
  'revit',
  'rx-?\\d+',
  'sketchup',
  'soundpad',
  'sp-flash-tool',
  'spss',
  'solidworks',
  'systemcare',
  'ultfone',
  'ultra-?iso',
  'uttorent',
  'winrar',
  'fifa-?\\d+',
  'manus',
  'github-copilot',
  'wise-(?:care|regist\\w+)',
  'wonde?share',
  'winutilit\\w*',
  'windows-optimizer',
  'ads-blocker',
]

const CHEAT_AND_LURE = [
  'trainer(?:-tool)?$',
  '\\w*unlock(?:er|tool)',
  'anyunlock',
  'imei-repair',
  'skin-?swapper',
  'game-?copier',
  'robux',
  'v-?bucks',
  'executor',
  'bypass',
  'exitlag',
  'seed-?phrase',
  'crypto-?generator',
  'auto-?withdraw',
  'jailbreak-prompt',
  'liker-bot',
  'follower-?bot',
  'server-?cloner',
  'quest-?completer',
  'patreon-?viewer',
  'ph-?downloader',
  'whale-?tracker',
  'honeypot-?detector',
  'trading-?bot',
  'metatrader',
  'aimbot',
  'wallhack',
  'spoofer',
  'mod-?menu',
  'portfolio-?rebalancer',
  'voice-?changer',
  'slideshow-video-maker',
]

// Genuine open-source projects that impostor accounts copy, with the only owner that is real.
const FAMOUS_PROJECT_OWNERS: Record<string, string> = {
  scrcpy: 'genymobile',
  rufus: 'pbatard',
  anydesk: '',
  betterdiscord: 'betterdiscord',
  obsstudio: 'obsproject',
  handbrake: 'handbrake',
  audacity: 'audacity',
  qbittorrent: 'qbittorrent',
  '7zip': 'ip7z',
}

const TEXT_SPAM_PATTERNS: RegExp[] = [
  /\b(?:crack(?:ed)?|keygen|key-?gen|warez|nulled|activator|serial[\s-]?key|license[\s-]?key|product[\s-]?key|patcher)\b/i,
  /\b(?:monero|crypto|bitcoin|btc|eth)[\s-]?miner\b/i,
  /\b(?:free[\s-]?download|download[\s-]?(?:free|full)|full[\s-]?version|pre-?activated|no[\s-]?survey|premium[\s-]?unlocked)\b/i,
  /\b(?:adobe|acrobat|photoshop|illustrator|premiere|autocad|office|windows|directory[\s-]?opus|idm|winrar|vegas|camtasia|sketchup)[\s-]\S*[\s-]?(?:pro|premium|ultimate|full|free|activated)\b/i,
]

const README_SPAM_PATTERNS: RegExp[] = [
  /(?:download|get)\s+(?:the\s+)?(?:crack|keygen|full\s+version|activator)/i,
  /activation\s+(?:key|code)s?/i,
  /password\s*[:=]\s*\S+/i,
  /free\s+download/i,
  /\b(?:crack|keygen)\b/i,
  /premium\s+unlocked/i,
  /\]\([^)]+\.(?:zip|rar|7z|exe|msi|dmg)(?:\?[^)]*)?\)/i,
]

const joinedPattern = (parts: string[]) => new RegExp(`(?:^|[-_.\\s])(?:${parts.join('|')})`, 'i')
const COMMERCIAL_PATTERN = joinedPattern(COMMERCIAL_SOFTWARE)
const CHEAT_PATTERN = joinedPattern(CHEAT_AND_LURE)

// \b treats _ as a word character, so turn it (and dots) into spaces before matching.
const normalizeForText = (text: string): string => text.replace(/[_.]+/g, ' ')
const alnum = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '')

function splitFullName(fullName: string, ownerLogin?: string | null) {
  const [first = '', second] = fullName.split('/')
  return second === undefined
    ? { owner: ownerLogin ?? '', name: first }
    : { owner: ownerLogin ?? first, name: second }
}

function ownerShapeWeight(login: string): number {
  if (/^[A-Za-z0-9-]+$/.test(login) === false) return 0
  const trailingDigits = login.match(/\d+$/)?.[0].length ?? 0
  const letters = login.replace(/[\d-]+/g, '')
  let weight = 0
  if (trailingDigits >= 6) weight += 2
  else if (trailingDigits >= 2 && letters.length >= 6) weight += 1
  const camelWords = login.match(/[A-Z][a-z]{2,}/g) ?? []
  if (/^[A-Za-z0-9]+$/.test(login) && camelWords.length >= 3) weight += 2
  else if (/^[A-Z][a-z]{10,}\d*$/.test(login)) weight += 1
  else if (camelWords.length === 2 && alnum(login).length >= 12) weight += 1
  else if (/^[a-z]{13,}$/.test(login)) weight += 1
  return Math.min(weight, OWNER_SHAPE_CAP)
}

function nameSignals(name: string, owner: string): Signal[] {
  const signals: Signal[] = []
  const ownerKey = alnum(owner)
  const brand = COMMERCIAL_PATTERN.exec(name)
  const brandKey = brand ? alnum(brand[0]) : ''
  if (
    brand &&
    !(ownerKey.length >= 4 && (ownerKey.includes(brandKey) || brandKey.includes(ownerKey)))
  ) {
    signals.push({ reason: `commercial software name "${name}"`, weight: 2 })
  }
  if (CHEAT_PATTERN.test(name)) signals.push({ reason: `cheat or lure name "${name}"`, weight: 2 })
  const famousOwner = FAMOUS_PROJECT_OWNERS[alnum(name)]
  if (famousOwner !== undefined && ownerKey !== famousOwner) {
    signals.push({ reason: `copy of well-known project "${name}"`, weight: 2 })
  }
  return signals
}

function textSignals(text: string): Signal[] {
  const normalized = normalizeForText(text)
  const hit = TEXT_SPAM_PATTERNS.find((pattern) => pattern.test(normalized))
  return hit
    ? [{ reason: `spam wording in description (${hit.source.slice(0, 30)})`, weight: 3 }]
    : []
}

function readmeSignals(readme: string | null | undefined): Signal[] {
  if (!readme) return []
  const hit = README_SPAM_PATTERNS.find((pattern) => pattern.test(readme))
  return hit ? [{ reason: 'spam wording or download link in README', weight: 3 }] : []
}

function popularitySignals(input: GithubSpamInput, now: Date): Signal[] {
  const signals: Signal[] = []
  const bare = !input.description?.trim() && !input.topics?.length
  const known = input.description !== undefined && input.topics !== undefined
  if (known && bare && !input.language) {
    signals.push({ reason: 'no description, topics or language', weight: 3 })
  } else if (known && bare && input.stars >= ANOMALOUS_STARS) {
    signals.push({ reason: `${input.stars} stars with no description or topics`, weight: 1 })
  }
  const createdMs = new Date(input.createdAt).getTime()
  const ageDays = Math.max((now.getTime() - createdMs) / DAY_MS, 0.25)
  if (known && !input.description?.trim() && input.stars / ageDays > IMPLAUSIBLE_STARS_PER_DAY) {
    signals.push({ reason: 'implausible star velocity', weight: 3 })
  }
  return signals
}

function ownerSignals(input: GithubSpamInput, owner: string): Signal[] {
  if (input.ownerType === 'Organization') return []
  const signals: Signal[] = []
  const shape = owner ? ownerShapeWeight(owner) : 0
  if (shape > 0) signals.push({ reason: `owner "${owner}" looks auto-generated`, weight: shape })
  if (input.ownerCreatedAt) {
    const ownerAgeDays =
      (new Date(input.createdAt).getTime() - new Date(input.ownerCreatedAt).getTime()) / DAY_MS
    if (ownerAgeDays < NEW_OWNER_DAYS && input.stars >= ANOMALOUS_STARS) {
      signals.push({
        reason: `${input.stars} stars on an account ${Math.max(Math.round(ownerAgeDays), 0)} days old`,
        weight: 2,
      })
    }
  }
  return signals
}

/** Scores a GitHub repo for cracked-software, cheat, crypto-lure and impostor spam; spam when score >= 3. */
export function githubSpamVerdict(input: GithubSpamInput): GithubSpamVerdict {
  const now = input.now ?? new Date()
  const { owner, name } = splitFullName(input.fullName, input.ownerLogin)
  const descriptionText = [input.description ?? '', ...(input.topics ?? [])].join(' \n ')
  const signals = [
    ...nameSignals(name, owner),
    ...textSignals(`${input.fullName} ${descriptionText}`),
    ...readmeSignals(input.readme),
    ...ownerSignals(input, owner),
    ...popularitySignals(input, now),
  ]
  const score = signals.reduce((sum, s) => sum + s.weight, 0)
  return { spam: score >= SPAM_SCORE_THRESHOLD, score, reasons: signals.map((s) => s.reason) }
}
