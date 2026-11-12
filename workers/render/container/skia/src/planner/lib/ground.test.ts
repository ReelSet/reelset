import { describe, expect, it } from 'vitest'
import { isSetupNumber } from './ground'

describe('isSetupNumber', () => {
  const said = 'It surpasses MOPD in half the training steps across 1.7B and 4B models.'

  it('treats a model size as setup, not a result', () => {
    expect(isSetupNumber('1.7B', 'training', said)).toBe(true)
    expect(isSetupNumber('4B', 'models', said)).toBe(true)
    expect(isSetupNumber('70B', 'parameters', 'a 70B parameter model')).toBe(true)
  })

  it('treats the size of the input as setup', () => {
    expect(isSetupNumber('94', 'pictures', 'It learned a likeness from 94 pictures.')).toBe(true)
    expect(isSetupNumber('3,000', 'examples', 'trained on 3,000 examples')).toBe(true)
  })

  it('treats a bare decimal table cell as setup, sign or not', () => {
    expect(isSetupNumber('261.18', 'worst-domain recovery', 'it hit -261.18 in Table 1')).toBe(true)
    expect(isSetupNumber('-261.18', 'recovery', 'it hit -261.18')).toBe(true)
    expect(isSetupNumber('94.70', 'recovery', 'recovery 94.70')).toBe(true)
  })

  it('keeps real outcomes and stakes', () => {
    expect(
      isSetupNumber('94.7%', 'average recovery', 'recovery reaches 94.7% on 1.7B models'),
    ).toBe(false)
    expect(isSetupNumber('7.1', 'GB', 'memory drops to 7.1 GB')).toBe(false)
    expect(isSetupNumber('5,000', 'messages a day', 'senders above 5,000 messages a day')).toBe(
      false,
    )
    expect(isSetupNumber('12×', 'faster', 'Muon math is 12x faster')).toBe(false)
    expect(
      isSetupNumber('~20 min', 'MOSS-Image LoRA training · was 49 min', 'about 20 minutes'),
    ).toBe(false)
    expect(isSetupNumber('2B', 'downloads', 'it passed 2B downloads')).toBe(false)
  })
})
