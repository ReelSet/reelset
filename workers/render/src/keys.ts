export const REELS_PREFIX = 'reels/'

export function videoKeyFor(itemId: string, renderKey: string): string {
  return `${REELS_PREFIX}${itemId}/${renderKey}.mp4`
}

export function posterKeyFor(itemId: string, renderKey: string): string {
  return `${REELS_PREFIX}${itemId}/${renderKey}.jpg`
}

export function containerJobId(renderKey: string): string {
  return `r${renderKey.slice(0, 40)}`
}
