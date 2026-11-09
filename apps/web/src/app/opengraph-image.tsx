import { ImageResponse } from 'next/og'

export const alt = 'Reelset: what developers are building, in 60-second reels'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 96px',
        background: 'radial-gradient(circle at 85% 10%, #1f2a0a 0%, #09090b 55%)',
        color: '#f4f4f5',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 620 }}>
        <div style={{ fontSize: 34, color: '#c8f751', letterSpacing: 2 }}>REELSET</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, marginTop: 24 }}>
          What developers are building, in 60-second reels.
        </div>
        <div style={{ fontSize: 28, color: '#a1a1aa', marginTop: 28 }}>
          GitHub, Hacker News, Reddit, YouTube and news. One swipe at a time.
        </div>
      </div>
      <div
        style={{
          width: 270,
          height: 480,
          borderRadius: 40,
          background: '#c8f751',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'rotate(-6deg)',
          boxShadow: '40px 30px 0 -8px rgba(200,247,81,0.18)',
        }}
      >
        <div
          style={{
            width: 0,
            height: 0,
            borderTop: '55px solid transparent',
            borderBottom: '55px solid transparent',
            borderLeft: '92px solid #0b0d04',
            marginLeft: 20,
          }}
        />
      </div>
    </div>,
    size,
  )
}
