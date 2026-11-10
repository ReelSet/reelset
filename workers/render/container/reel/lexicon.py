import re

SPOKEN_WORDS = {
    "MOPD": "M O P D",
    "DKIM": "dee kim",
    "DMARC": "dee mark",
    "nginx": "engine x",
    "kubectl": "kube control",
    "sudo": "sue doo",
    "SQLite": "S Q lite",
    "PostgreSQL": "post gress Q L",
    "OAuth": "oh auth",
}

LETTER_TLDS = {"js": "J S", "ai": "A I", "io": "I O"}
WORD_TLDS = ("com", "org", "net", "dev", "app")
SCALE_WORDS = {"K": "thousand", "M": "million", "B": "billion", "T": "trillion"}

_VOWELS = "AEIOUY"
_CONSONANT_ACRONYM = re.compile(r"(?<![A-Za-z])([B-DF-HJ-NP-TV-XZ]{2,6})(?![A-Za-z])")
_SQUARED = re.compile(r"\bP(?:\^2|²)-?")
_SCALED_NUMBER = re.compile(r"\b(\d+(?:\.\d+)?)([KMBT])\b")
_DOMAIN_SUFFIX = re.compile(r"(?<=\w)\.(" + "|".join((*WORD_TLDS, *LETTER_TLDS)) + r")\b")
_EQUALS = re.compile(r"(?<=\w)=(?=\w)")
_WORD_TOKEN = re.compile(r"[A-Za-z]+")


def _spell(match: re.Match) -> str:
    return " ".join(match.group(1))


def _domain_suffix(match: re.Match) -> str:
    suffix = match.group(1)
    return f" dot {LETTER_TLDS.get(suffix, suffix)}"


def _scaled(match: re.Match) -> str:
    return f"{match.group(1)} {SCALE_WORDS[match.group(2)]}"


def _replace_known_words(token: str) -> str:
    def swap(match: re.Match) -> str:
        return SPOKEN_WORDS.get(match.group(0), match.group(0))

    return _WORD_TOKEN.sub(swap, token)


def spoken_form(token: str) -> str:
    """What the voice should be given for one script token; timings stay keyed to the token itself."""
    spoken = _SQUARED.sub("P squared ", token)
    spoken = _SCALED_NUMBER.sub(_scaled, spoken)
    spoken = _DOMAIN_SUFFIX.sub(_domain_suffix, spoken)
    spoken = _EQUALS.sub(" equals ", spoken)
    spoken = _replace_known_words(spoken)
    spoken = _CONSONANT_ACRONYM.sub(_spell_if_acronym, spoken)
    return " ".join(spoken.split())


def _spell_if_acronym(match: re.Match) -> str:
    letters = match.group(1)
    return _spell(match) if letters.isupper() and not any(v in letters for v in _VOWELS) else letters
