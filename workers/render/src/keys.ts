export const REELS_PREFIX = 'reels/'

export function videoKeyFor(itemId: string, renderKey: string): string {
  return `${REELS_PREFIX}${itemId}/${renderKey}.mp4`
}

export function posterKeyFor(itemId: string, renderKey: string): string {
  return `${REELS_PREFIX}${itemId}/${renderKey}.jpg`
}

const VIDEO_KEY_PATTERN = new RegExp(`^${REELS_PREFIX}([^/]+)/([^/]+)\\.mp4$`)

// Poster of the same render as a videoKeyFor key; null for any key not built by videoKeyFor.
export function posterKeyForVideoKey(videoKey: string): string | null {
  const [, itemId, renderKey] = VIDEO_KEY_PATTERN.exec(videoKey) ?? []
  return itemId && renderKey ? posterKeyFor(itemId, renderKey) : null
}

export function containerJobId(renderKey: string): string {
  return `r${renderKey.slice(0, 40)}`
}
