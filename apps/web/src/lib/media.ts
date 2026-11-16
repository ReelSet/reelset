import { mediaKeyUrl } from '@reelset/core'

export function mediaUrl(base: string, key: string | null): string | null {
  return key ? mediaKeyUrl(base, key) : null
}
