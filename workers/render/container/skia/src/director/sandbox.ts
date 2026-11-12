import vm from 'node:vm'
import { KIT_NAMES } from './api-doc'

export const LOAD_TIMEOUT_MS = 10_000

/**
 * Evaluates model-written scene code in a fresh vm context holding only the kit and a parsed DATA.
 * vm is not a hard security boundary (kit objects expose host constructors); the scrubbed child
 * environment is what protects secrets. The script's own declarations shadow kit names inside a block.
 */
export function loadScript(
  code: string,
  data: unknown,
  kit: Record<string, unknown>,
  timeoutMs = LOAD_TIMEOUT_MS,
): unknown {
  const sandbox: Record<string, unknown> = {}
  for (const name of KIT_NAMES) sandbox[name] = kit[name]
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  sandbox.DATA = new vm.Script(`JSON.parse(${JSON.stringify(JSON.stringify(data))})`).runInContext(
    context,
  )
  const script = new vm.Script(`(function () {\n{\n${code}\n}\n})()`, { filename: 'scenes.js' })
  return script.runInContext(context, { timeout: timeoutMs })
}
