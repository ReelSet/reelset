import { describe, expect, it } from 'vitest'
import { endName, endSource, endSubtitle, type EndCtx } from './endcard'

const base: EndCtx = { title: 'x', source: 'github', domain: 'github.com', facts: {} }

describe('end card', () => {
  const repo: EndCtx = {
    ...base,
    title: 'Moss training has a very large speed boost in Fizgig',
    headline: 'Fizgig: faster LoRA training',
    facts: {
      repo: {
        owner: 'shootthesound',
        name: 'Fizgig',
        description: 'Studio for training, fixing and exploring LoRAs. Runs on consumer GPUs.',
      },
    },
  }

  it('names the repo and its source line', () => {
    expect(endName(repo)).toBe('shootthesound/Fizgig')
    expect(endSource(repo)).toBe('github.com/shootthesound/Fizgig')
  })

  it('shows the repo description, never the raw release or commit title', () => {
    expect(endSubtitle(repo)).toBe('Studio for training, fixing and exploring LoRAs')
    expect(endSubtitle({ ...repo, facts: { repo: { owner: 'a', name: 'b' } } })).toBe('')
  })

  it('drops the short name a paper title already led with', () => {
    const paper: EndCtx = {
      ...base,
      source: 'papers',
      domain: 'huggingface.co',
      title: 'P²-MOPD: Parameter-space on-policy distillation',
    }
    expect(endName(paper)).toBe('P²-MOPD')
    expect(endSubtitle(paper)).toBe('Parameter-space on-policy distillation')
  })

  it('says nothing that repeats the name or the headline', () => {
    const news: EndCtx = {
      ...base,
      source: 'news',
      title: 'Outlook rejecting email without DMARC',
      headline: 'Outlook rejecting emails without DMARC',
    }
    expect(endSubtitle(news)).toBe('')
  })

  it('sentence-cases what is left', () => {
    expect(
      endSubtitle({ ...base, source: 'hn', title: 'a new way to cache', headline: 'Caching' }),
    ).toBe('A new way to cache')
  })
})
