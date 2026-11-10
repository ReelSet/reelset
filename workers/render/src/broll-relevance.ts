export const RECENT_REELS_WINDOW = 8

type Profile = { query: string; must: string[] }

const PROFILES: Record<string, Profile> = {
  'network cables': {
    query: 'ethernet cable',
    must: ['ethernet', 'cable', 'cables', 'network', 'router', 'wires', 'fiber', 'patch'],
  },
  'server room': {
    query: 'server rack',
    must: ['server', 'servers', 'rack', 'racks', 'data', 'datacenter', 'center'],
  },
  'data center': {
    query: 'data center servers',
    must: ['data', 'datacenter', 'center', 'server', 'servers', 'rack'],
  },
  'code on screen': {
    query: 'programming code monitor',
    must: ['code', 'coding', 'programming', 'screen', 'monitor', 'laptop', 'computer', 'software'],
  },
  'keyboard typing': {
    query: 'mechanical keyboard typing',
    must: ['keyboard', 'typing', 'keys', 'laptop', 'computer'],
  },
  'terminal screen': {
    query: 'command line terminal screen',
    must: ['terminal', 'command', 'code', 'coding', 'screen', 'computer', 'monitor'],
  },
  'circuit board': {
    query: 'electronic circuit board',
    must: ['circuit', 'board', 'electronic', 'electronics', 'chip', 'motherboard', 'microchip'],
  },
  'computer chip': {
    query: 'microchip processor',
    must: ['chip', 'microchip', 'processor', 'circuit', 'electronic', 'motherboard', 'cpu'],
  },
  'fiber optic': {
    query: 'fiber optic cable',
    must: ['fiber', 'fibre', 'optic', 'optical', 'cable', 'cables', 'light'],
  },
  'cyber security': {
    query: 'cyber security digital lock',
    must: ['cyber', 'security', 'lock', 'padlock', 'digital', 'hacker', 'code', 'shield'],
  },
  padlock: {
    query: 'digital padlock',
    must: ['padlock', 'lock', 'security', 'digital', 'cyber', 'key'],
  },
  'email inbox': {
    query: 'email on computer screen',
    must: ['email', 'mail', 'inbox', 'envelope', 'message', 'laptop', 'screen'],
  },
  'envelope letters': {
    query: 'envelope mail',
    must: ['envelope', 'envelopes', 'mail', 'letter', 'letters', 'email', 'post'],
  },
  'digital art': {
    query: 'digital art abstract',
    must: ['digital', 'art', 'abstract', 'pixels', 'neon', 'light', 'particles'],
  },
  'camera lens': {
    query: 'camera lens closeup',
    must: ['camera', 'lens', 'photography', 'aperture'],
  },
  'abstract data visualization': {
    query: 'data visualization abstract',
    must: ['data', 'visualization', 'abstract', 'digital', 'particles', 'network', 'graph'],
  },
  'digital particles': {
    query: 'digital particles abstract',
    must: ['digital', 'particles', 'abstract', 'light', 'lights', 'glowing', 'technology'],
  },
  'abstract technology': {
    query: 'abstract technology background',
    must: ['abstract', 'technology', 'digital', 'futuristic', 'light', 'lights', 'glowing', 'data'],
  },
}

const TECH_CONTEXT = new Set(
  'technology tech digital data code coding programming computer computers laptop screen screens monitor monitors display keyboard server servers rack racks network networking cable cables wire wires ethernet fiber optic circuit board chip chips microchip processor hardware electronic electronics binary matrix abstract particles light lights glowing futuristic cyber security lock padlock internet web cloud database storage software terminal motherboard gpu robot robotic artificial intelligence neural mail email inbox envelope message router switch connection connectivity virtual hologram interface'.split(
    ' ',
  ),
)

const GENERIC = new Set(
  'clip video footage stock shot shots view close closeup up of a an the in on with and at for to from by into over under slow motion time lapse background loop looping 4k hd'.split(
    ' ',
  ),
)

/** Slug words that disqualify a clip outright: people-centric scenes and worlds the search terms wander into. */
const REJECT = new Set(
  'woman women man men girl boy person people child children kid kids baby couple family businessman businesswoman businesspeople team colleagues coworkers student students face smiling tram trams train trains subway metro gondola funicular chairlift ski skiing car cars vehicle traffic hallway corridor tunnel stairs staircase plaster mask solder soldering welding stock stocks trading forex candlestick bridge bridges driving road roads highway street streets city cityscape building buildings architecture landscape nature sky sea ocean beach mountain forest restaurant food coffee tourist tourists assembly workshop repair repairing gym workout fitness exercise'.split(
    ' ',
  ),
)

const stem = (word: string) => word.slice(0, 5)

export function profileFor(term: string): Profile {
  return PROFILES[term] ?? { query: term, must: term.split(' ') }
}

/** The Pexels search phrase for an abstract term: a concrete, unambiguous scene instead of "network cables". */
export const queryFor = (term: string): string => profileFor(term).query

/** Words of the slug that actually describe the scene. */
const contentWords = (words: readonly string[]) => words.filter((w) => !GENERIC.has(w))

export const isRejectedScene = (words: readonly string[]): boolean =>
  words.some((w) => REJECT.has(w))

/**
 * A described clip must name the term or a tech scene word: "a cable car in the city" never passes for
 * "network cables". A slug with no descriptive words at all gives nothing to judge and passes.
 */
export function matchesIntent(words: readonly string[], term: string): boolean {
  const content = contentWords(words)
  if (content.length === 0) return true
  const wanted = new Set(profileFor(term).must.map(stem))
  return content.some((w) => TECH_CONTEXT.has(w) || wanted.has(stem(w)))
}
