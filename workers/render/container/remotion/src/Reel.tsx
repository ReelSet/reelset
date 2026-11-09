import { useMemo } from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { Background, BottomFade } from './Background'
import { Captions } from './Captions'
import { SceneFrame } from './fx'
import { Header } from './Header'
import { artForSlot, planArt, type ArtPlan } from './lib/art'
import { planImages, type ImagePlan } from './lib/images'
import { toFrames, totalFrames } from './lib/timeline'
import type { ReelProps, TimedScene } from './lib/types'
import { CodeScene } from './scenes/Code'
import { HookScene } from './scenes/Hook'
import { ImageScene } from './scenes/ImageScene'
import { ArtScene } from './scenes/ArtScene'
import { OutroScene } from './scenes/Outro'
import { QuoteScene } from './scenes/Quote'
import { StatScene } from './scenes/Stat'
import { TitleScene } from './scenes/Title'
import { OVERLAP } from './theme'

function SceneBody({
  scene,
  index,
  props,
  plan,
  imagePlan,
}: {
  scene: TimedScene
  index: number
  props: ReelProps
  plan: ArtPlan
  imagePlan: ImagePlan
}) {
  const { source, sourceLabel, title, cover } = props
  const art = { kind: artForSlot(plan, index), seed: plan.seed, tool: plan.tool }
  if (scene.kind === 'hook') {
    const words = props.words.filter((w) => w.start < scene.end)
    return (
      <HookScene
        text={scene.text}
        words={words}
        frames={scene.frames}
        hero={imagePlan.hero}
        play={source === 'youtube' && imagePlan.hero?.kind === 'thumbnail'}
        {...art}
      />
    )
  }
  if (scene.kind === 'outro') {
    return (
      <OutroScene
        title={title}
        domain={props.domain}
        sourceLabel={sourceLabel}
        source={source}
        cover={cover}
        frames={scene.frames}
        {...art}
        kind={artForSlot(plan, 0)}
      />
    )
  }
  const shown = imagePlan.beats.get(index)
  if (shown) return <ImageScene image={shown} domain={props.domain} frames={scene.frames} />
  const v = scene.visual
  switch (v.type) {
    case 'title':
      return <TitleScene title={v.title} subtitle={v.subtitle} frames={scene.frames} {...art} />
    case 'code':
      return <CodeScene language={v.language} code={v.code} frames={scene.frames} />
    case 'stat':
      return <StatScene label={v.label} value={v.value} frames={scene.frames} />
    case 'quote':
      return <QuoteScene text={v.text} attribution={v.attribution} />
    default:
      return <ArtScene frames={scene.frames} {...art} />
  }
}

export function Reel(props: ReelProps) {
  const { fps } = useVideoConfig()
  const total = totalFrames(props.durationSeconds, fps)
  const plan = useMemo(() => planArt(props), [props])
  const imagePlan = useMemo(() => planImages(props), [props])
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
            <SceneBody scene={scene} index={i} props={props} plan={plan} imagePlan={imagePlan} />
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
