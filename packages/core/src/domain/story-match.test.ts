import { describe, expect, it } from 'vitest'
import { sameStory, storyWords } from './story-match'

describe('sameStory', () => {
  it('matches reworded headlines of one story', () => {
    expect(
      sameStory(
        'Nvidia reinstates Jensen Huang as CEO',
        'Nvidia Reinstates Jensen Huang as CEO Amid Scandal',
      ),
    ).toBe(true)
    expect(
      sameStory('Nvidia reinstates Jensen Huang', 'Nvidia reinstates Jensen Huang as CEO'),
    ).toBe(true)
    expect(
      sameStory(
        'Anthropic Breaks Below $83 IPO Price in Premarket Trading',
        'Anthropic IPO price falls below $83 in premarket',
      ),
    ).toBe(true)
  })

  it('keeps different stories about the same company apart', () => {
    expect(sameStory('OpenAI releases GPT-6', 'OpenAI delays GPT-6')).toBe(false)
    expect(
      sameStory('Nvidia stock falls 5% after earnings', 'Nvidia reinstates Jensen Huang as CEO'),
    ).toBe(false)
  })

  it('matches short titles such as repo names only when identical', () => {
    expect(sameStory('ubiquitarianism/leonida', 'ProjectLeonida/Leonida')).toBe(false)
    expect(sameStory('ProjectLeonida/Leonida', 'projectleonida/leonida')).toBe(true)
    expect(sameStory('', 'anything at all here')).toBe(false)
  })

  it('keeps numbers and versions as words', () => {
    expect([...storyWords('GTA 6 trailer drops, v2.1 out')]).toEqual([
      'gta',
      '6',
      'trailer',
      'drop',
      'v2.1',
      'out',
    ])
  })
})
