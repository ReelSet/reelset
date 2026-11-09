import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { Background, BottomFade } from './Background'
import { Captions } from './Captions'
import { SceneFrame } from './fx'
import { Header } from './Header'
import { toFrames, totalFrames } from './lib/timeline'
import type { ReelProps, TimedScene } from './lib/types'
import { CodeScene } from './scenes/Code'
import { HookScene } from './scenes/Hook'
import { ImageScene } from './scenes/ImageScene'
import { OutroScene } from './scenes/Outro'
import { QuoteScene } from './scenes/Quote'
import { StatScene } from './scenes/Stat'
import { TitleScene } from './scenes/Title'
import { OVERLAP } from './theme'

function SceneBody({
  scene,
  index,
  props,
}: {
  scene: TimedScene
  index: number
  props: ReelProps
}) {
  const { source, sourceLabel, title, illustration, cover } = props
  const common = { frames: scene.frames, source, sourceLabel, title }
  if (scene.kind === 'hook') {
    const words = props.words.filter((w) => w.start < scene.end)
    return <HookScene text={scene.text} words={words} hero={illustration ?? cover} {...common} />
  }
  if (scene.kind === 'outro') {
    return <OutroScene domain={props.domain} hero={cover ?? illustration} {...common} />
  }
  const v = scene.visual
  switch (v.type) {
    case 'title':
      return <TitleScene title={v.title} subtitle={v.subtitle} index={index} />
    case 'code':
      return <CodeScene language={v.language} code={v.code} frames={scene.frames} />
    case 'stat':
      return <StatScene label={v.label} value={v.value} frames={scene.frames} />
    case 'quote':
      return <QuoteScene text={v.text} attribution={v.attribution} />
    default:
      return <ImageScene file={v.file ?? cover ?? illustration} {...common} />
  }
}

export function Reel(props: ReelProps) {
  const { fps } = useVideoConfig()
  const total = totalFrames(props.durationSeconds, fps)
  const scenes = toFrames(props.scenes, fps, total)
  const hookEnd = props.scenes[0]?.kind === 'hook' ? props.scenes[0].end : 0
  const captionWords = props.words.filter((w) => w.start >= hookEnd - 0.01)
  return (
    <AbsoluteFill>
      <Background />
      {scenes.map((scene, i) => (
        <Sequence
          key={i}
          from={scene.from}
          durationInFrames={scene.frames + (i < scenes.length - 1 ? OVERLAP : 0)}
          layout="none"
        >
          <SceneFrame frames={scene.frames + (i < scenes.length - 1 ? OVERLAP : 0)}>
            <SceneBody scene={scene} index={i} props={props} />
          </SceneFrame>
        </Sequence>
      ))}
      <BottomFade />
      <Header scenes={scenes} source={props.source} sourceLabel={props.sourceLabel} />
      <Captions words={captionWords} />
      {props.audio ? <Audio src={staticFile(props.audio)} /> : null}
    </AbsoluteFill>
  )
}
