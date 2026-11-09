import re

from .timing import Word

_NORM = re.compile(r"[^0-9a-z]")


def _norm(text: str) -> str:
    return _NORM.sub("", text.lower())


def restore_punctuation(text: str, words: list) -> list:
    """TTS word events drop punctuation; put the narration's own tokens back so captions can break on it.

    Words are matched to whitespace tokens by normalized prefix. A token the TTS split into several
    words (hyphens, slashes) keeps its trailing punctuation on the last piece. Unmatched words keep
    their TTS text, so a tokenizer mismatch degrades to plain words instead of failing.
    """
    tokens = text.split()
    out = []
    ti = 0
    consumed = 0
    for word in words:
        target = _norm(word.text)
        shown = word.text
        if ti < len(tokens) and target:
            rest = _norm(tokens[ti])[consumed:]
            if rest.startswith(target):
                consumed += len(target)
                if consumed >= len(_norm(tokens[ti])):
                    shown = tokens[ti] if consumed == len(target) else _tail(tokens[ti], word.text)
                    ti += 1
                    consumed = 0
        out.append(Word(shown, word.start, word.end))
    return out


def _tail(token: str, piece: str) -> str:
    match = re.search(r"[^0-9A-Za-z]*$", token)
    return piece + (match.group(0) if match else "")
