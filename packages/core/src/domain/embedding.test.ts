import { describe, expect, it } from 'vitest'
import {
  EMBEDDING_DIMENSIONS,
  EmbeddingShapeError,
  fromVectorLiteral,
  toVectorLiteral,
} from './embedding'

const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i / 1000)

describe('vector literals', () => {
  it('round-trips a 768-dim vector', () => {
    expect(fromVectorLiteral(toVectorLiteral(vector))).toEqual(vector)
  })

  it('rejects the wrong dimension count (e.g. a 1536-dim model swapped in)', () => {
    expect(() => toVectorLiteral(new Array(1536).fill(0))).toThrow(EmbeddingShapeError)
    expect(() => toVectorLiteral([])).toThrow(/expected 768/)
  })

  it('rejects NaN and Infinity, which pgvector would refuse', () => {
    const withNaN = [...vector]
    withNaN[10] = Number.NaN
    expect(() => toVectorLiteral(withNaN)).toThrow(/index 10/)
    const withInf = [...vector]
    withInf[0] = Number.POSITIVE_INFINITY
    expect(() => toVectorLiteral(withInf)).toThrow(EmbeddingShapeError)
  })

  it('rejects malformed literals coming back from the database', () => {
    expect(() => fromVectorLiteral('1,2,3')).toThrow(/wrapped/)
    expect(() => fromVectorLiteral('[1,2,3]')).toThrow(/malformed/)
    expect(() => fromVectorLiteral(`[${new Array(768).fill('x').join(',')}]`)).toThrow()
  })
})
