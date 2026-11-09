import re

from .timing import Word

_NORM = re.compile(r"[^0-9a-z]")
_CUE = re.compile(r"^(?P<word>[^#]+)(?:#(?P<n>[1-9]))?$")


def _norm(text: str) -> str:
    return _NORM.sub("", text.lower())


def resolve_cue(cue: str, words: list, start: float, end: float) -> float | None:
    """Seconds at which a spoken-word cue ('word' or 'word#n', nth occurrence) is said inside the
    [start, end) window of narration, or None when the word is not spoken there."""
    match = _CUE.match(cue)
    if not match:
        return None
    target = _norm(match["word"])
    nth = int(match["n"] or 1)
    if not target:
        return None
    seen = 0
    for w in words:
        if w.start < start - 1e-6 or w.start >= end:
            continue
        if _norm(w.text) == target:
            seen += 1
            if seen == nth:
                return w.start
    return None


def resolve_shots(beats: list, words: list, spans: list) -> list:
    """Beat shots with `t` (seconds). `spans` holds one (start, end) per narration segment, hook
    first, so beat i uses spans[i + 1]. Shots whose cue word is not in the beat are dropped, and
    times stay strictly increasing and inside the beat."""
    out = []
    for beat, (start, end) in zip(beats, spans[1:-1]):
        last = start - 1.0
        for shot in beat.shots:
            t = resolve_cue(shot["at"], words, start, end)
            if t is None or t <= last + 0.25:
                continue
            last = t
            out.append({**shot, "t": round(t, 3)})
    return out
