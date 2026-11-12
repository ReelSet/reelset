import type { DrawReport } from './config'
import { applyScenes } from './scene-reel'
import { normalizeScenes } from './scenes'
import { loadScript } from './sandbox'
import * as kit from './kit'
import { dataOf } from './prompt'
import type { Reel } from '../plan'

export type SceneReel = { reel: Reel; errors: () => DrawReport['sceneErrors'] }

const MAX_ERROR_CHARS = 300

/** Loads the model's script in the sandbox and builds the reel it describes. Throws when it cannot load. */
export function loadSceneReel(base: Reel, code: string): SceneReel {
  const raw = loadScript(code, dataOf(base), kit as unknown as Record<string, unknown>)
  const scenes = normalizeScenes(raw, base.duration, base.props.broll?.length ?? 0)
  const failed = new Map<number, string>()
  const reel = applyScenes(base, scenes, (index, scene, message) => {
    if (!failed.has(index))
      failed.set(
        index,
        `${scene.t0.toFixed(1)}-${scene.t1.toFixed(1)}s ${message}`.slice(0, MAX_ERROR_CHARS),
      )
  })
  return {
    reel,
    errors: () => [...failed.entries()].map(([scene, message]) => ({ scene, message })),
  }
}
