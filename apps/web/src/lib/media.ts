export function mediaUrl(base: string, key: string | null): string | null {
  if (!key) return null
  return `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`
}
