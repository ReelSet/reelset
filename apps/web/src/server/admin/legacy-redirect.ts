import { redirect } from 'next/navigation'

type SearchParams = Record<string, string | string[] | undefined>

/** Sends a retired admin URL to its new home, keeping the query string (range, flash, filters). */
export function redirectLegacy(to: string, searchParams: SearchParams): never {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, v)
    }
  }
  const qs = query.toString()
  redirect(qs ? `${to}?${qs}` : to)
}
