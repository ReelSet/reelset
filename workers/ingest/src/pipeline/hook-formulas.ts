// Hook formulas adapted from github.com/Jakeschincariol/instagram-agent-skill
// (skills/ig-reel/hooks.json, MIT, (c) Jake Schincariol), rewritten for a narrator with no "I":
// first-person formulas are dropped and the examples are tech facts.

export type HookFormula = {
  name: string
  template: string
  example: string
  trap: string
}

export const HOOK_FORMULAS: readonly HookFormula[] = [
  {
    name: 'Time Collapse',
    template: '{Task} used to take {long time}. Now it takes {short time}.',
    example: 'Training this took 49 minutes. Now it takes 20.',
    trap: 'A ratio nobody believes, or a time the sources do not state.',
  },
  {
    name: 'The Replacement',
    template: '{This thing} replaces {the expensive or heavy thing}.',
    example: 'One free file just replaced a $200 a month tool.',
    trap: 'Overstating it. If it replaces part of the job, say which part.',
  },
  {
    name: 'Nobody Tells You',
    template: 'Nobody tells you that {uncomfortable truth about a thing they use}.',
    example: 'Nobody tells you your AI chats can end up in search results.',
    trap: 'A truth everybody already repeats.',
  },
  {
    name: 'Wrong Way, Right Way',
    template: "You're {doing thing} the slow way. {The fix}.",
    example: "You're prompting the slow way. One line fixes it.",
    trap: 'A habit the viewer does not actually have.',
  },
  {
    name: 'If This, Then Watch',
    template: 'If you {specific situation}, {this} fixes it.',
    example: 'If your laptop chokes on AI models, this one fits.',
    trap: 'A situation so broad it fits nobody ("if you want to learn AI").',
  },
  {
    name: 'Head To Head',
    template: '{A} versus {B}. {The surprising winner}.',
    example: 'A $600 Mac just beat a $3,000 GPU rig.',
    trap: 'Refusing to say who won.',
  },
  {
    name: 'Permission',
    template: "You don't need {the thing everyone says you need}.",
    example: "You don't need a GPU to run this model.",
    trap: 'Removing the blocker and putting nothing in its place.',
  },
  {
    name: 'The Statistic',
    template: '{Number with unit} {surprising fact}.',
    example: '97 percent of this app was written by AI.',
    trap: 'A number that is not in the sources.',
  },
  {
    name: 'The Reveal',
    template: 'This new {thing} {does the one thing people wanted}.',
    example: 'This new Google model runs offline on your phone.',
    trap: 'Naming the thing without saying what it changes.',
  },
  {
    name: 'Contrarian Flip',
    template: '{What everyone assumes, turned around.}',
    example: 'A model 20 times smaller just won.',
    trap: 'Flipping a belief nobody holds.',
  },
  {
    name: 'The Superlative',
    template: 'The {fastest / cheapest / only} way to {outcome} is {answer}.',
    example: 'The cheapest way to run AI at home is a used Mac.',
    trap: 'A soft answer ("is practice").',
  },
  {
    name: 'The Deadline',
    template: '{Thing} changes on {real date}. Do {action} first.',
    example: 'This free tier ends in March. Export your data first.',
    trap: 'Made-up urgency. Only when the sources give the date.',
  },
  {
    name: 'Negative Command',
    template: 'Stop {common habit}. {Alternative}.',
    example: 'Stop pasting your API key into chat. Do this.',
    trap: 'A habit nobody has.',
  },
  {
    name: 'The Question People Ask',
    template: '{The exact question a beginner types}?',
    example: 'Can a free AI model really write a whole app?',
    trap: 'A question with an obvious answer, or "Have you ever wondered".',
  },
  {
    name: "Someone Else's Result",
    template: '{A named person or team} {did the surprising thing} in {time}.',
    example: 'One developer rebuilt Slack in a single weekend.',
    trap: 'No name in the sources. An anonymous miracle is a rumour.',
  },
]

export function hookFormulasPrompt(): string {
  return HOOK_FORMULAS.map(
    (f) => `- ${f.name}: ${f.template} Example: "${f.example}" Trap: ${f.trap}`,
  ).join('\n')
}
