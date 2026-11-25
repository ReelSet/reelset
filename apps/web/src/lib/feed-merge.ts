/** Keeps the reel the viewer is watching at the top of a refreshed list so it never swaps under them. */
export function pinCurrentFirst<T extends { id: string }>(
  current: T | undefined,
  incoming: T[],
): T[] {
  if (!current) return incoming
  return [current, ...incoming.filter((it) => it.id !== current.id)]
}
