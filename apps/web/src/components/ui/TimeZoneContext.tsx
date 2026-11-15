'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_TIME_ZONE } from '@/lib/time/zone'

const TimeZoneContext = createContext(DEFAULT_TIME_ZONE)

/** Hands a server-resolved viewer time zone to client components below a dynamic layout. */
export function TimeZoneProvider({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}

export const useTimeZone = () => useContext(TimeZoneContext)
