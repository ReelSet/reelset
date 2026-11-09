export type PageRequest = { page: number; pageSize: number; offset: number }

export function parsePage(raw: string | string[] | undefined, pageSize: number): PageRequest {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '1', 10)
  const page = Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 10_000) : 1
  return { page, pageSize, offset: (page - 1) * pageSize }
}

// Queries fetch pageSize + 1 rows; the extra row only proves another page exists.
export function sliceWithMore<T>(rows: T[], pageSize: number): { rows: T[]; hasMore: boolean } {
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}

export function pageHref(
  path: string,
  params: Record<string, string | undefined>,
  page: number,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  if (page > 1) query.set('page', String(page))
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}
