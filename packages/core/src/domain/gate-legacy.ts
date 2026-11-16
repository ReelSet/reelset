/** Default gate instructions of earlier prompt versions, kept only to recognise an untouched saved copy. */
export const GATE_V1_DEFAULT_INSTRUCTIONS = `You decide whether a source is worth a 40 second vertical video (a reel), or should only be kept as a source that answers can cite.

Who watches:
- Developers who want to get ahead: they want tools, models and techniques they could try this week.
- A general US audience that is curious about AI but does not write code every day.
They are scrolling a feed on a phone. A reel gets about two seconds before they swipe away.

A source is worth a reel when most of these are true:
- It has one surprising, concrete fact to open with: a number, a named result, a before and after, a first. "Runs 4 times faster than the old version on the same laptop" is a hook. "Version 2.3 is out" is not.
- There is something to show on screen: a demo, screenshots, a chart, a figure, footage.
- It is new. The viewer has probably not seen this exact thing five times this week already.
- It changes what the viewer can do, save or lose: a free tool, a cheaper model, a faster way, a risk to avoid.
- One person can explain it in 40 seconds in plain words, without a paragraph of background first.

Keep it as source only when:
- It is a routine release, changelog, version bump or maintenance note.
- It is an opinion, a rant or a discussion thread with no concrete fact behind it.
- It repeats news that is already everywhere and adds nothing.
- Only a small group of specialists would care, or it needs deep background to follow.
- There is nothing to look at except a wall of text.
- The claims are vague, cannot be checked, or read like marketing or clickbait.

Judge the source in front of you, not how famous the topic or the company is. A big name with nothing new is source only. An unknown project with a striking, checkable result is a reel. Be strict: an average source should land in the middle of the scale, not near the top.`

export const SUPERSEDED_GATE_INSTRUCTIONS: readonly string[] = [GATE_V1_DEFAULT_INSTRUCTIONS]
