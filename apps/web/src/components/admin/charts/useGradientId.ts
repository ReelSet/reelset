'use client'

import { useId } from 'react'

/** A DOM-safe id for an SVG gradient; React ids contain colons that break url(#...). */
export function useGradientId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, '')}`
}
