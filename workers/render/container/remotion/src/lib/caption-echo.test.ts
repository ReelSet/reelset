import { describe, expect, it } from 'vitest'
import { echoesCaption, isSentenceCase, showable } from './caption-echo'

describe('echoesCaption', () => {
  it('flags a near-verbatim copy of the captions', () => {
    expect(
      echoesCaption('Expert parameters guide the student', 'expert parameters guide the student'),
    ).toBe(true)
    expect(echoesCaption('Bounced emails', 'to the bounced emails and then')).toBe(true)
    expect(
      echoesCaption(
        'Optimizes coefficients and weights',
        'it jointly optimizes mixing coefficients and student weights',
      ),
    ).toBe(true)
  })

  it('keeps a statement that says something the captions do not', () => {
    expect(echoesCaption('Training now takes twenty minutes', 'used to take almost an hour')).toBe(
      false,
    )
    expect(echoesCaption('The student learns from every expert', 'experts guide the student')).toBe(
      false,
    )
  })

  it('never calls a one-word statement an echo', () => {
    expect(echoesCaption('Flux', 'models like Flux and Qwen')).toBe(false)
  })
})

describe('isSentenceCase', () => {
  it('wants a capital, a digit or a quote first', () => {
    expect(isSentenceCase('Experts guide the student')).toBe(true)
    expect(isSentenceCase('12 passes fix the screen')).toBe(true)
    expect(isSentenceCase('“Quoted” claim')).toBe(true)
    expect(isSentenceCase('linear combination')).toBe(false)
    expect(isSentenceCase('expert weights')).toBe(false)
  })
})

describe('showable', () => {
  it('needs sentence case and no echo', () => {
    expect(showable('Experts guide the student', 'and then something else')).toBe(true)
    expect(showable('expert weights', 'other words entirely')).toBe(false)
    expect(showable('Experts guide the student', 'experts guide the student')).toBe(false)
    expect(showable('  ', 'x')).toBe(false)
  })
})
