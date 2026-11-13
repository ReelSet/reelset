type Confirmed<T, R> = { value: T; result: R }

type Slot<T, R, B> = {
  wanted: T
  base: B
  confirmed: Confirmed<T, R> | null
}

/**
 * Serializes writes per key and keeps only the latest wanted value: one request in flight, and
 * results for superseded values are dropped, so the last user intent always wins.
 */
export function createIntentQueue<T, R, B>(opts: {
  send: (key: string, value: T) => Promise<R>
  onSettled: (key: string, value: T, result: R) => void
  onFailed: (key: string, base: B, confirmed: Confirmed<T, R> | null) => void
}) {
  const slots = new Map<string, Slot<T, R, B>>()

  async function drain(key: string, slot: Slot<T, R, B>) {
    try {
      for (;;) {
        const sent = slot.wanted
        try {
          const result = await opts.send(key, sent)
          slot.confirmed = { value: sent, result }
          if (Object.is(slot.wanted, sent)) {
            opts.onSettled(key, sent, result)
            return
          }
        } catch {
          if (Object.is(slot.wanted, sent)) {
            opts.onFailed(key, slot.base, slot.confirmed)
            return
          }
        }
      }
    } finally {
      slots.delete(key)
    }
  }

  return {
    wanted(key: string): T | undefined {
      return slots.get(key)?.wanted
    },
    set(key: string, value: T, base: B) {
      const slot = slots.get(key)
      if (slot) {
        slot.wanted = value
        return
      }
      const created: Slot<T, R, B> = { wanted: value, base, confirmed: null }
      slots.set(key, created)
      void drain(key, created)
    },
  }
}
