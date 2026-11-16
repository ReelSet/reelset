import { describe, expect, it } from 'vitest'
import {
  STYLE_LIMITS,
  readingGrade,
  sentences,
  styleIssues,
  syllables,
} from '../src/pipeline/plain'

const easy = {
  hook: "You don't need a GPU to run this model.",
  beats: [
    { text: "That matters if you're learning AI on a normal laptop. Cloud bills add up fast." },
    { text: 'Ollama shrinks the model so it fits in 8 gigabytes of memory. Then it runs offline.' },
    {
      text: "But it's slower than a big graphics card, so long jobs take a while.",
    },
  ],
  outro: 'No GPU, one command. Try it on the laptop you already have.',
}

describe('sentences and syllables', () => {
  it('splits on sentence ends but not inside decimals or versions', () => {
    expect(sentences('It scored 0.998 on v2.1 tests. Then it ran offline! Why?')).toEqual([
      'It scored 0.998 on v2.1 tests.',
      'Then it ran offline!',
      'Why?',
    ])
  })

  it('counts syllables roughly and caps names and numbers', () => {
    expect(syllables('fast')).toBe(1)
    expect(syllables('laptop')).toBe(2)
    expect(syllables('quantization')).toBeGreaterThanOrEqual(4)
    expect(syllables('1,240')).toBe(2)
    expect(syllables('GPU')).toBe(3)
  })
})

describe('readingGrade', () => {
  it('rates plain short sentences far below dense jargon', () => {
    const plain = readingGrade('It shrinks the model so it runs on your laptop. No cloud needed.')
    const dense = readingGrade(
      'This framework leverages quantization methodologies to facilitate localized inference capabilities on consumer hardware configurations.',
    )
    expect(plain).toBeLessThan(6)
    expect(dense).toBeGreaterThan(14)
  })
})

describe('styleIssues', () => {
  it('passes an easy script', () => {
    expect(styleIssues(easy)).toEqual([])
  })

  it('flags a long sentence and says where', () => {
    const long = {
      ...easy,
      beats: [
        {
          text: 'That matters because if you are learning AI on a normal laptop then the cloud bills that you pay every month add up very fast.',
        },
        ...easy.beats.slice(1),
      ],
    }
    const issues = styleIssues(long)
    expect(issues.join(' ')).toMatch(/beat 1 has a \d+-word sentence/)
    expect(issues.join(' ')).toContain(`over ${STYLE_LIMITS.maxSentenceWords} words`)
  })

  it('flags a hard-to-read script by school grade', () => {
    const dense = {
      ...easy,
      beats: easy.beats.map(() => ({
        text: 'Quantization methodologies facilitate localized inference capabilities. Heterogeneous configurations necessitate architectural considerations.',
      })),
    }
    expect(styleIssues(dense).join(' ')).toContain('school grade')
  })

  it('flags a beat that packs in too many numbers', () => {
    const crowded = {
      ...easy,
      beats: [
        { text: 'It hit 94.7% on one test, 81.2% on another, used 12 GB and ran in 40 ms.' },
        ...easy.beats.slice(1),
      ],
    }
    expect(styleIssues(crowded).join(' ')).toContain('more than 2 numbers')
  })

  it('flags an outro that does not loop back to the hook', () => {
    const flat = { ...easy, outro: 'Install it with one command and see for yourself.' }
    expect(styleIssues(flat).join(' ')).toContain('shares no word with the hook')
  })

  it('flags narration that never says you', () => {
    const cold = {
      hook: 'A GPU is not needed to run this model.',
      beats: [
        { text: 'Ollama shrinks the model so it fits in 8 gigabytes of memory.' },
        { text: 'It runs offline on a normal laptop.' },
      ],
      outro: 'No GPU, one command.',
    }
    expect(styleIssues(cold).join(' ')).toContain('say "you"')
  })

  it('flags three beats in a row with nothing concrete and machine-sounding shapes', () => {
    const vague = {
      ...easy,
      beats: [
        { text: 'That matters a lot if you want to learn.' },
        { text: "It's not just a tool, it's a whole new way to work." },
        { text: 'The catch is that it can be slow sometimes.' },
      ],
    }
    const issues = styleIssues(vague).join(' ')
    expect(issues).toContain('three beats in a row')
    expect(issues).toContain('not just X')
  })

  it('flags narration chopped into fragments', () => {
    const choppy = {
      ...easy,
      beats: [
        { text: 'It runs agents. Each gets a worktree. That is a copy. So no collisions.' },
        { text: 'It works on Free. You can bring a key. Git is required.' },
        { text: 'But the download is a rar file, so read the repo first.' },
      ],
    }
    expect(styleIssues(choppy).join(' ')).toContain('sounds robotic')
  })

  it('flags a labelled catch and a story with no turn', () => {
    const labelled = {
      ...easy,
      beats: [
        easy.beats[0]!,
        easy.beats[1]!,
        { text: "The catch: it's slower than a big graphics card, so long jobs take a while." },
      ],
    }
    const issues = styleIssues(labelled).join(' ')
    expect(issues).toContain('beat 3 announces itself with a label')
    expect(issues).toContain('the story never turns')
  })

  it('flags a catch dressed as a turn and a stock question outro', () => {
    const stock = {
      ...easy,
      beats: [
        easy.beats[0]!,
        { text: 'But the catch is speed, so long jobs take a while to finish.' },
      ],
      outro: 'Would you run a model on your laptop?',
    }
    const issues = styleIssues(stock).join(' ')
    expect(issues).toContain('beat 2 announces itself with a label')
    expect(issues).toContain('stock ending')
  })

  it("flags the authors' voice and a turn followed by side facts", () => {
    const tangent = {
      ...easy,
      beats: [
        easy.beats[0]!,
        { text: 'We tested it on 3 laptops, and it ran on every one of them without a GPU.' },
        { text: "But it's slower than a big graphics card, so long jobs take a while." },
        { text: 'The company was founded in 2021 and also ships a phone app for Android users.' },
        { text: 'There is a Windows build too, and a Linux one that runs on older machines.' },
      ],
    }
    const issues = styleIssues(tangent).join(' ')
    expect(issues).toContain('speaks as the source')
    expect(issues).toContain('the turn comes in beat 3 of 5')
  })

  it('flags a hook over the character cap', () => {
    const long = {
      ...easy,
      hook: "You really don't need any kind of expensive GPU or a monthly cloud bill to run this brand new open model at home, you know.",
    }
    expect(styleIssues(long)[0]).toContain('the hook is')
  })
})
