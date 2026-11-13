import pino from 'pino'
import { describe, expect, it } from 'vitest'
import type { Database } from '@reelset/core'
import { followBodySchema } from '@/lib/topics'
import { setTopicFollow } from './preferences'

const log = pino({ level: 'silent' })

function fakeDb(topics: string[] | undefined) {
  const c: Record<string, unknown> = {}
  for (const m of ['set', 'where', 'returning']) c[m] = () => c
  c['executeTakeFirst'] = async () => (topics ? { topics } : undefined)
  return { updateTable: () => c } as unknown as Database
}

const input = { profileId: 'p', topic: 'rust', following: true }

describe('setTopicFollow', () => {
  it('follows when the topic lands in the stored list', async () => {
    expect(await setTopicFollow(fakeDb(['ai', 'rust']), input, log)).toEqual({
      status: 'ok',
      topics: ['ai', 'rust'],
    })
  })

  it('reports full when the follow was refused', async () => {
    const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect((await setTopicFollow(fakeDb(full), input, log)).status).toBe('full')
  })

  it('unfollow succeeds even when nothing was stored', async () => {
    expect(await setTopicFollow(fakeDb(['ai']), { ...input, following: false }, log)).toEqual({
      status: 'ok',
      topics: ['ai'],
    })
  })
})

describe('followBodySchema', () => {
  it('accepts a slug with a desired state', () => {
    expect(followBodySchema.safeParse({ topic: 'claude-code', following: false }).success).toBe(
      true,
    )
  })

  it('rejects bad slugs and missing state', () => {
    expect(followBodySchema.safeParse({ topic: 'Bad Slug', following: true }).success).toBe(false)
    expect(followBodySchema.safeParse({ topic: 'ai' }).success).toBe(false)
  })
})
