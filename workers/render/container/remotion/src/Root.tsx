import { loadFont } from '@remotion/fonts'
import { Composition, staticFile, type CalculateMetadataFunction } from 'remotion'
import { Reel } from './Reel'
import { totalFrames } from './lib/timeline'
import type { ReelProps } from './lib/types'
import { FPS, H, W } from './theme'
import { sampleProps } from './sample'

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

const fonts = Promise.all([
  loadFont({
    family: 'Geist',
    url: staticFile('fonts/geist.woff2'),
    weight: '100 900',
    unicodeRange: LATIN,
  }),
  loadFont({
    family: 'Geist',
    url: staticFile('fonts/geist-ext.woff2'),
    weight: '100 900',
    unicodeRange: EXT,
  }),
  loadFont({ family: 'Geist Mono', url: staticFile('fonts/geist-mono.woff2'), weight: '100 900' }),
])

const calculateMetadata: CalculateMetadataFunction<ReelProps> = async ({ props }) => {
  await fonts
  return { durationInFrames: totalFrames(props.durationSeconds, FPS) }
}

export function Root() {
  return (
    <Composition
      id="Reel"
      component={Reel}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={FPS * 30}
      defaultProps={sampleProps}
      calculateMetadata={calculateMetadata}
    />
  )
}
