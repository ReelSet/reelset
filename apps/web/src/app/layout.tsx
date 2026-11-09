import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

const DESCRIPTION = 'What developers are building, in 60-second reels.'

export const metadata: Metadata = {
  metadataBase: new URL('https://reelset.app'),
  title: {
    default: 'Reelset: what developers are building, in 60-second reels',
    template: '%s | Reelset',
  },
  description: DESCRIPTION,
  applicationName: 'Reelset',
  appleWebApp: { capable: true, title: 'Reelset', statusBarStyle: 'black-translucent' },
  openGraph: {
    type: 'website',
    siteName: 'Reelset',
    title: 'Reelset',
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: 'Reelset', description: DESCRIPTION },
}

export const viewport: Viewport = {
  themeColor: '#09090b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
