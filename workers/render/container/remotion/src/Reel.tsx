import { useMemo } from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { Captions } from './Captions'
import { Transition } from './fx'
import { Header } from './Header'
import { Headline } from './Headline'
import { headlineEnd, headlineOf, resolveShots, snapHeadlineEnd, toFrames, totalFrames } from './lib/timeline'
import { overlapFrames, pickTransitions } from './lib/transitions'
import type { ReelProps } from './lib/types'
import { SCREENS } from './screens'
import type { ReelCtx } from './screens/ui'
import { COLOR, H, HEADLINE_PAD, W } from './theme'


function Finish() {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%), linear-gradient(to top, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0) 18%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${staticFile('grain.png')})`,
          backgroundSize: '256px 256px',
          opacity: 0.05,
          mixBlendMode: 'overlay',
        }}
      />
    </AbsoluteFill>
  )
}

export function Reel(props: ReelProps) {
  const { fps } = useVideoConfig()
  const total = totalFrames(props.durationSeconds, fps)
  const plan = useMemo(() => props.plan ?? resolveShots(props, fps, total).shots, [props, fps, total])
  const scenes = useMemo(() => toFrames(props.scenes, fps, total), [props, fps, total])
  const ctx: ReelCtx = useMemo(
    () => ({
      title: props.title,
      source: props.source,
      sourceLabel: props.sourceLabel,
      domain: props.domain,
      facts: props.facts ?? {},
      images: props.images ?? [],
      hook: props.scenes[0]?.kind === 'hook' ? props.scenes[0].text : props.title,
    }),
    [props],
  )
  const headline = headlineOf(props)
  const headlineFrames = Math.round(snapHeadlineEnd(headlineEnd(props), plan, fps) * fps)
  const transitions = useMemo(() => pickTransitions(plan.map((s) => s.show)), [plan])
  return (
    <AbsoluteFill style={{ background: COLOR.bg, width: W, height: H }}>
      {plan.map((shot, i) => {
        const Screen = SCREENS[shot.show]
        const topPad = shot.from < headlineFrames ? HEADLINE_PAD : 0
        return (
          <Sequence
            key={i}
            from={shot.from}
            durationInFrames={shot.frames + overlapFrames(transitions[i + 1])}
            layout="none"
          >
            <Transition kind={transitions[i] ?? null}>
              <Screen frames={shot.frames} ctx={ctx} props={shot.props} topPad={topPad} />
            </Transition>
          </Sequence>
        )
      })}
      <Finish />
      <Header scenes={scenes} source={props.source} sourceLabel={props.sourceLabel} />
      <Sequence durationInFrames={headlineFrames} layout="none">
        <Headline text={headline} frames={headlineFrames} />
      </Sequence>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: Math.round(H * 0.53),
          height: Math.round(H * 0.25),
          background:
            'linear-gradient(to bottom, rgba(9,9,11,0) 0%, rgba(9,9,11,0.62) 30%, rgba(9,9,11,0.62) 70%, rgba(9,9,11,0) 100%)',
        }}
      />
      <Captions words={props.words} />
      {props.audio ? <Audio src={staticFile(props.audio)} /> : null}
    </AbsoluteFill>
  )
}
