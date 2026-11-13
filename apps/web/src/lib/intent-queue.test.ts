import { describe, expect, it } from 'vitest'
import { createIntentQueue } from './intent-queue'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup() {
  const sent: boolean[] = []
  const pending: ReturnType<typeof deferred<number>>[] = []
  const settled: [boolean, number][] = []
  const failed: [string, { n: number }, unknown][] = []
  const queue = createIntentQueue<boolean, number, { n: number }>({
    send: (_k, v) => {
      sent.push(v)
      const d = deferred<number>()
      pending.push(d)
      return d.promise
    },
    onSettled: (_k, v, r) => settled.push([v, r]),
    onFailed: (k, base, confirmed) => failed.push([k, base, confirmed]),
  })
  return { queue, sent, pending, settled, failed }
}

describe('createIntentQueue', () => {
  it('never has two requests in flight and ends on the last intent', async () => {
    const { queue, sent, pending, settled } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    expect(sent).toEqual([true])
    pending[0]!.resolve(1)
    await tick()
    expect(sent).toEqual([true, false])
    pending[1]!.resolve(0)
    await tick()
    expect(settled).toEqual([[false, 0]])
    expect(queue.wanted('a')).toBeUndefined()
  })

  it('does not resend when the intent returns to the in-flight value', async () => {
    const { queue, sent, pending, settled } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    queue.set('a', true, { n: 0 })
    pending[0]!.resolve(1)
    await tick()
    expect(sent).toEqual([true])
    expect(settled).toEqual([[true, 1]])
  })

  it('reports wanted while pending', () => {
    const { queue } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    expect(queue.wanted('a')).toBe(false)
  })

  it('keeps keys independent', () => {
    const { queue, sent } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('b', true, { n: 0 })
    expect(sent).toEqual([true, true])
  })

  it('rolls back to the base when the latest request fails', async () => {
    const { queue, pending, failed, settled } = setup()
    queue.set('a', true, { n: 5 })
    pending[0]!.reject(new Error('x'))
    await tick()
    expect(settled).toEqual([])
    expect(failed).toEqual([['a', { n: 5 }, null]])
  })

  it('retries with the newer intent when a superseded request fails', async () => {
    const { queue, sent, pending, failed, settled } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    pending[0]!.reject(new Error('x'))
    await tick()
    expect(sent).toEqual([true, false])
    pending[1]!.resolve(0)
    await tick()
    expect(failed).toEqual([])
    expect(settled).toEqual([[false, 0]])
  })

  it('reports the last confirmed value when a later request fails', async () => {
    const { queue, pending, failed } = setup()
    queue.set('a', true, { n: 0 })
    queue.set('a', false, { n: 0 })
    pending[0]!.resolve(1)
    await tick()
    pending[1]!.reject(new Error('x'))
    await tick()
    expect(failed).toEqual([['a', { n: 0 }, { value: true, result: 1 }]])
  })

  it('accepts a new write after settling', async () => {
    const { queue, sent, pending } = setup()
    queue.set('a', true, { n: 0 })
    pending[0]!.resolve(1)
    await tick()
    queue.set('a', false, { n: 1 })
    expect(sent).toEqual([true, false])
  })
})
