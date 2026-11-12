import type { Reel, Shot } from '../plan'
import type { Screen } from '../screens/types'
import * as K from './kit'
import type { Scene } from './scenes'

export type SceneErrorSink = (sceneIndex: number, scene: Scene, message: string) => void

// Errors thrown inside the sandbox are from another realm, so they are never `instanceof Error` here.
const messageOf = (err: unknown): string =>
  typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : String(err)

function screenOf(scene: Scene, index: number, onError: SceneErrorSink): Screen {
  return {
    tone: () => scene.tone,
    captions: () => scene.cap,
    draw(a) {
      K.S.c = a.c
      const X = {
        vid: () => a.media.backdrop(),
        img: (k: number) => a.media.image(k),
        backdrop: (k: number) => K.blurred(a.media.image(k)),
      }
      try {
        scene.fn(a.abs, a.t, X)
      } catch (err) {
        onError(index, scene, messageOf(err))
        throw err
      }
    },
  }
}

/** Replaces the planner's shots with the model's scenes; a throwing scene is reported and the Renderer falls back for it. */
export function applyScenes(base: Reel, scenes: Scene[], onError: SceneErrorSink): Reel {
  const shots: Shot[] = scenes.map((scene, i) => ({
    index: i,
    show: 'KeyPoint',
    props: scene.clip === null ? {} : { bg: scene.clip },
    t0: scene.t0,
    t1: scene.t1,
    dur: scene.t1 - scene.t0,
    sceneIndex: i,
    origin: 'planned',
    topPad: 0,
    clip: scene.clip === null ? null : (base.props.broll?.[scene.clip] ?? null),
    enter: i === 0 ? null : scenes[i - 1]!.exit === 'up' ? 'up' : 'left',
    screen: screenOf(scene, i, onError),
    grade: scene.grade,
  }))
  return { ...base, shots, headline: null }
}
