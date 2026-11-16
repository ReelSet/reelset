// Story shapes distilled from transcripts of high-retention explainer reels (cinematic science and
// AI shorts in the 100K-3M view range). The shared pattern: one surprising idea, a hook that opens
// a question, a middle that unfolds as a sequence instead of a feature list, one "But" turn, and a
// last line that reframes the hook. Examples are patterns only; their facts are never sources.

export type StoryShape = {
  name: string
  fits: string
  beats: string
  example: string
}

export const STORY_SHAPES: readonly StoryShape[] = [
  {
    name: 'Experiment',
    fits: 'papers, benchmarks, anyone who tested something and got a strange result',
    beats:
      'the setup in one line, what they did step by step, what came out, the "But" that makes it strange, what it means for the viewer',
    example:
      'Hook: "AI models just got caught passing secret messages, and nobody can figure out how they did it." Middle: "Researchers taught one model to love owls, then had it write lists of plain numbers. A fresh model trained on only those numbers. It never saw the word owl, and it still picked owls as its favorite animal. But when they scrubbed the numbers clean, it happened again." End: "So models can pass things to each other that we cannot see, filter or explain."',
  },
  {
    name: 'Mystery Reveal',
    fits: 'a hidden cause, a design choice, a problem people feel but cannot name',
    beats:
      'describe the effect or the thing without naming it, add details that build the question, name it, then the twist that puts the viewer inside it',
    example:
      'Hook: "There is a building designed to make you forget what time it is." Middle: "No clocks, no windows, and the lighting never changes. The hallways curve so you cannot see the exit. This is a casino. But you are inside one right now. Infinite scroll and autoplay are the same tricks, moved into your pocket." End: "The longer you stay, the more they make. How long have you been playing today?"',
  },
  {
    name: 'Before And After',
    fits: 'a rewrite, a new release, a tool that removes a pain',
    beats:
      'the old pain as a scene the viewer has lived, why it was like that, what changed, the proof, the "But" cost',
    example:
      'Hook: "Five years ago, building this app took a whole year and 70,000 dollars." Middle: "The hardest part was the data, a scraper that broke all the time. This time the old code went into an AI coding tool with one request: make it reliable. It came back working, on real data. But you still have to know what you asked for." End: "A year of work then. One afternoon now."',
  },
  {
    name: 'Countdown',
    fits: 'a repo or release with several features, a list of options, risks or futures',
    beats:
      'say how many and tease the last one in the hook, one beat per item with one concrete detail, save the strongest or strangest item for last',
    example:
      'Hook: "There are five ways AI can go from here, and the last one is what has people worried." Middle: "One, it stays a tool we control. Two, progress stalls. Three, it makes a few people rich and pushes workers out. Four, it becomes a weapon. Five, we lose control of it." End: "The question is not whether AI shapes the future. It is whether that future has room for us."',
  },
  {
    name: 'Hidden Cost',
    fits: 'a trade-off, a risk, a too-good-to-be-true release, security or money stories',
    beats:
      'the promise everyone sees, how it works in plain words, the "But" that shows who pays and how, the size of the cost, what a careful person does',
    example:
      'Hook: "{The free thing} costs you nothing, and {someone} is quietly paying for it." Middle: "{How it works in one plain line}. {The number that shows the size}. But {who pays, and how}." End: "{A line that turns the hook around, or one question for the viewer}."',
  },
]

export function storyShapesPrompt(): string {
  return STORY_SHAPES.map(
    (s) => `- ${s.name} (fits ${s.fits}): ${s.beats}.\n  Pattern: ${s.example}`,
  ).join('\n')
}

export const STORY_SHAPE_NAMES = STORY_SHAPES.map((s) => s.name)
