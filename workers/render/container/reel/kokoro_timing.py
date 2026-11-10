import difflib

from .timing import Word

PUNCTUATION = frozenset(".,!?;:…—–-\"'“”‘’()[]")


def _align(expected: str, actual: str) -> list:
    """Index into actual for every character of expected, -1 where the two diverge."""
    if expected == actual:
        return list(range(len(expected)))
    mapping = [-1] * len(expected)
    matcher = difflib.SequenceMatcher(None, expected, actual, autojunk=False)
    for tag, e0, e1, a0, _ in matcher.get_opcodes():
        if tag == "equal":
            mapping[e0:e1] = range(a0, a0 + (e1 - e0))
    return mapping


def _token_span(matched: list, actual: str, owners: list, timed: list) -> tuple | None:
    spoken = [i for i in matched if actual[i] not in PUNCTUATION] or matched
    if not spoken:
        return None
    return timed[owners[spoken[0]]].start, timed[owners[spoken[-1]]].end


def regroup(tokens: list, token_phonemes: list, phoneme_timings: list) -> list:
    """One Word per script token from per-phoneme timings.

    token_phonemes[i] is the phoneme string synthesized for tokens[i]. Whitespace is ignored on
    both sides because the model's batching and pause insertion move it. A token whose phonemes
    cannot be located (empty, or lost in the model vocabulary) collapses to a zero-length word at
    the previous end, so the output always has one monotonic Word per token. Trailing punctuation
    phonemes are excluded from a word's span so the pause after a comma stays between words.
    """
    timed = [t for t in phoneme_timings if t.phoneme.strip()]
    actual = "".join(t.phoneme for t in timed)
    owners = [i for i, t in enumerate(timed) for _ in t.phoneme]
    parts = ["".join(p.split()) for p in token_phonemes]
    mapping = _align("".join(parts), actual)

    words = []
    cursor = 0.0
    position = 0
    for token, part in zip(tokens, parts):
        matched = [m for m in mapping[position : position + len(part)] if m >= 0]
        position += len(part)
        start, end = _token_span(matched, actual, owners, timed) or (cursor, cursor)
        start = max(start, cursor)
        end = max(end, start)
        words.append(Word(token, start, end))
        cursor = end
    return words
