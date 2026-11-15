'use client'

import { useSyncExternalStore } from 'react'
import { DEFAULT_TIME_ZONE, formatInZone, toDate, type TimeStyle } from '@/lib/time/zone'

const noopSubscribe = () => () => {}
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
const serverZone = () => DEFAULT_TIME_ZONE

/** The browser's time zone after hydration; UTC during SSR and the hydration pass, so markup matches. */
export function useBrowserTimeZone(): string {
  return useSyncExternalStore(noopSubscribe, browserZone, serverZone)
}

/** A time in the viewer's own zone for statically cached pages; renders UTC until hydrated. */
export function LocalTime({ value, style = 'date' }: { value: string; style?: TimeStyle }) {
  const zone = useBrowserTimeZone()
  const instant = toDate(value)
  return <time dateTime={instant?.toISOString()}>{formatInZone(instant, zone, style)}</time>
}
