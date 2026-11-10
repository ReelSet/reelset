import { useMemo } from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { Captions } from './Captions'
import { Transition } from './fx'
import { Header } from './Header'
import { Headline } from './Headline'
import {
  headlineEnd,
  headlineOf,
  resolveShots,
  snapHeadlineEnd,
  toFrames,
  totalFrames,
} from './lib/timeline'
import { PUNCH_SCALE, punchOrigin } from './lib/punch'
import { overlapFrames, pickTransitions } from './lib/transitions'
import { displayTitle, styleOf } from './lib/typeset'
import type { ReelProps } from './lib/types'
import { SCREENS } from './screens'
import { BackdropContext, type ReelCtx } from './screens/ui'
import { COLOR, H, HEADLINE_PAD, W } from './theme'

/** Second half of a held shot: the same screen, `lead` frames in, pushed in (see `pacePunches`). */
const punchOf = (p: Record<string, unknown>): { lead: number; frames: number } | null => {
  const v = p.punch as { lead?: unknown; frames?: unknown } | undefined
  return v && typeof v.lead === 'number' && typeof v.frames === 'number'
    ? { lead: v.lead, frames: v.frames }
    : null
}

const originFor = (shot: { show: string; props: Record<string, unknown> }): string =>
  punchOrigin(
    shot.show === 'KeyPoint' &&
      typeof shot.props.text === 'string' &&
      styleOf(shot.props.text) === 2,
  )

const clipFor = (clips: ReelProps['broll'], shotProps: Record<string, unknown>) => {
  const clip = clips && typeof shotProps.bg === 'number' ? clips[shotProps.bg] : undefined
  if (!clip) return null
  return typeof shotProps.bgAt === 'number' ? { ...clip, at: shotProps.bgAt } : clip
}

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
  const plan = useMemo(
    () => props.plan ?? resolveShots(props, fps, total).shots,
    [props, fps, total],
  )
  const scenes = useMemo(() => toFrames(props.scenes, fps, total), [props, fps, total])
  const ctx: ReelCtx = useMemo(
    () => ({
      title: displayTitle(props.title),
      source: props.source,
      sourceLabel: props.sourceLabel,
      domain: props.domain,
      facts: props.facts ?? {},
      images: props.images ?? [],
      demo: props.demo,
      hook: props.scenes[0]?.kind === 'hook' ? props.scenes[0].text : props.title,
    }),
    [props],
  )
  const headline = headlineOf(props)
  const headlineFrames = Math.round(snapHeadlineEnd(headlineEnd(props), plan, fps) * fps)
  const transitions = useMemo(
    () => pickTransitions(plan.map((s) => s.show)).map((t, i) => (plan[i]?.props.punch ? null : t)),
    [plan],
  )
  return (
    <AbsoluteFill style={{ background: COLOR.bg, width: W, height: H }}>
      {plan.map((shot, i) => {
        const Screen = SCREENS[shot.show]
        const punch = punchOf(shot.props)
        const startedAt = punch ? shot.from - punch.lead : shot.from
        const topPad = startedAt < headlineFrames ? HEADLINE_PAD : 0
        const screen = (
          <Screen
            frames={punch ? punch.frames : shot.frames}
            ctx={ctx}
            props={shot.props}
            topPad={topPad}
          />
        )
        return (
          <Sequence
            key={i}
            from={shot.from}
            durationInFrames={shot.frames + overlapFrames(transitions[i + 1])}
            layout="none"
          >
            <Transition kind={transitions[i] ?? null}>
              <BackdropContext.Provider value={clipFor(props.broll, shot.props)}>
                {punch ? (
                  <AbsoluteFill
                    style={{
                      transform: `scale(${PUNCH_SCALE})`,
                      transformOrigin: originFor(shot),
                    }}
                  >
                    <Sequence from={-punch.lead} layout="none">
                      {screen}
                    </Sequence>
                  </AbsoluteFill>
                ) : (
                  screen
                )}
              </BackdropContext.Provider>
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
