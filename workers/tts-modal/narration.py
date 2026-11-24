"""Helpers shared by the Modal narrators: spoken wording, forced word alignment, a speech check
and mp3 encoding. Torch, torchaudio and num2words are imported inside functions so the module
loads on the local machine that runs `modal deploy`."""

import difflib
import re
import subprocess

GAP_SECONDS = 0.22
MP3_BITRATE = "128k"
LEVEL_FILTER = "loudnorm=I=-15:TP=-1.5:LRA=11"

# A run of this many extra or missing letters means a word was invented or dropped, not misheard.
MAX_LETTER_GAP = 12
MIN_LETTER_MATCH = 0.6
MAX_SECONDS_PER_LETTER = 0.16
MIN_SECONDS_PER_LETTER = 0.025
LOOP_GRACE_SECONDS = 1.5

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th|[kKMBx])?")
_SCALE = {"k": "thousand", "K": "thousand", "M": "million", "B": "billion", "x": "times"}


def _us_words(value, to: str = "cardinal") -> str:
    from num2words import num2words

    return num2words(value, lang="en", to=to).replace(" and ", " ").replace(",", "")


def _number_words(raw: str) -> str:
    suffix = ""
    if raw[-2:] in ("st", "nd", "rd", "th"):
        digits, suffix = raw[:-2], "ordinal"
    elif raw[-1] in _SCALE:
        digits, suffix = raw[:-1], _SCALE[raw[-1]]
    else:
        digits = raw
    digits = digits.replace(",", "")
    try:
        if suffix == "ordinal":
            return _us_words(int(digits), to="ordinal")
        if "." in digits:
            words = _us_words(float(digits))
        elif len(digits) == 4 and 1100 <= int(digits) <= 2099 and not suffix and "," not in raw:
            words = _us_words(int(digits), to="year")
        else:
            words = _us_words(int(digits))
    except (ValueError, OverflowError):
        return raw
    return f"{words} {suffix}" if suffix else words


def speech_text(token: str) -> str:
    """How a script token is said aloud: digits, percent and dollar amounts in words, punctuation kept."""
    text = token
    dollars = text.startswith("$") and any(c.isdigit() for c in text)
    text = text.replace("$", "").replace("%", " percent")
    text = _NUMBER.sub(lambda m: " " + _number_words(m.group()) + " ", text)
    if dollars:
        text = re.sub(r"^(\s*[^.,!?;:]+)", r"\1 dollars", text, count=1)
    return re.sub(r"\s+", " ", text).strip()


def spoken_form(token: str) -> str:
    """Letters the aligner can match for one token, upper case, words split by spaces."""
    text = re.sub(r"[^A-Za-z' ]+", " ", speech_text(token).replace("-", " "))
    return re.sub(r"\s+", " ", text).strip().upper()


def spoken_sentence(text: str) -> str:
    return " ".join(speech_text(token) for token in text.split())


def spread(tokens: list, start: float, end: float) -> list:
    weights = [len(token) + 1 for token in tokens]
    total = sum(weights) or 1
    cursor = start
    out = []
    for token, weight in zip(tokens, weights):
        nxt = cursor + (end - start) * weight / total
        out.append({"text": token, "start": cursor, "end": nxt})
        cursor = nxt
    return out


def emissions(wav, sample_rate: int, aligner, bundle):
    import torch
    import torchaudio

    with torch.inference_mode():
        audio = torchaudio.functional.resample(wav, sample_rate, bundle.sample_rate)
        emission, _ = aligner(audio.to(next(aligner.parameters()).device))
        return torch.log_softmax(emission, dim=-1).cpu()


def align_segment(wav, sample_rate: int, text: str, aligner, bundle, index: dict, logp=None) -> list:
    """One {text, start, end} per whitespace token, in seconds from the start of this segment."""
    import torch
    import torchaudio

    duration = wav.shape[1] / sample_rate
    tokens = text.split()
    spoken = [spoken_form(token) for token in tokens]
    transcript = "|".join(s.replace(" ", "|") for s in spoken if s)
    chars = [c for c in transcript if c in index]
    if not chars:
        return spread(tokens, 0.0, duration)
    if logp is None:
        logp = emissions(wav, sample_rate, aligner, bundle)
    if logp.shape[1] < len(chars):
        return spread(tokens, 0.0, duration)
    aligned, _ = torchaudio.functional.forced_align(logp, torch.tensor([[index[c] for c in chars]]), blank=0)
    frames = aligned[0].tolist()
    frame = duration / len(frames)

    spans = []
    previous = 0
    for position, token_id in enumerate(frames):
        if token_id != 0 and token_id != previous:
            spans.append([position, position + 1])
        elif token_id != 0 and spans:
            spans[-1][1] = position + 1
        previous = token_id

    cursor = 0
    words = []
    for token, form in zip(tokens, spoken):
        count = len([c for c in form.replace(" ", "|") if c in index])
        if count == 0 or cursor + count > len(spans):
            words.append({"text": token, "start": None, "end": None})
            continue
        words.append({"text": token, "start": spans[cursor][0] * frame, "end": spans[cursor + count - 1][1] * frame})
        cursor += count
        if cursor < len(chars) and chars[cursor] == "|":
            cursor += 1
    for i, word in enumerate(words):
        if word["start"] is None:
            before = next((w["end"] for w in reversed(words[:i]) if w["end"] is not None), 0.0)
            after = next((w["start"] for w in words[i + 1 :] if w["start"] is not None), duration)
            word["start"], word["end"] = before, max(before + 0.05, after)
    return words


def heard_letters(logp, labels: list) -> str:
    """Greedy CTC read of the emissions: what the speech recognizer heard, letters only."""
    best = logp[0].argmax(dim=-1).tolist()
    out, previous = [], None
    for token_id in best:
        if token_id != previous and token_id != 0:
            out.append(labels[token_id])
        previous = token_id
    return "".join(c for c in out if c.isalpha())


def speech_check(text: str, heard: str, seconds: float) -> dict:
    """Compares what was said with the script: a long run of extra or missing letters means the voice
    invented or dropped words; a duration far off the script length means a loop or a cut-off."""
    expected = "".join(c for c in "".join(spoken_form(t) for t in text.split()) if c.isalpha())
    matcher = difflib.SequenceMatcher(None, expected, heard, autojunk=False)
    gap = 0
    for op, a1, a2, b1, b2 in matcher.get_opcodes():
        if op != "equal":
            gap = max(gap, abs((a2 - a1) - (b2 - b1)) if op == "replace" else max(a2 - a1, b2 - b1))
    ratio = matcher.ratio()
    letters = max(len(expected), 1)
    too_long = seconds > letters * MAX_SECONDS_PER_LETTER + LOOP_GRACE_SECONDS
    too_short = seconds < letters * MIN_SECONDS_PER_LETTER
    ok = gap < MAX_LETTER_GAP and ratio >= MIN_LETTER_MATCH and not too_long and not too_short
    return {"ok": ok, "ratio": round(ratio, 3), "gap": gap, "tooLong": too_long, "tooShort": too_short}


def encode_mp3(audio, sample_rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(audio.squeeze(0).numpy(), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    command = [
        "ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-af", LEVEL_FILTER, "-ar", str(sample_rate), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-f", "mp3", "pipe:1",
    ]
    return subprocess.run(command, input=pcm, check=True, capture_output=True, timeout=120).stdout
